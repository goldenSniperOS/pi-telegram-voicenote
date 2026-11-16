/**
 * pi-telegram-voicenote: Telegram replies from Pi also arrive as a narrated voice note.
 *
 * Flow: on a Telegram turn (prompt starts with "[telegram]") the final assistant
 * message gets a `telegram_voice` marker naming a cached reply. pi-telegram delivers
 * the text, then calls our synthesis provider with the sentinel; we narrate the
 * cached reply with a Pi model, synthesize it, and return the OGG path.
 *
 * Voice input: we also register a transcription provider, so voice notes the
 * user sends reach the agent as text (OpenAI or local faster-whisper, see stt.ts).
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPath as defaultConfigPath, loadConfig, parseSttEngine, saveConfig, sttVenvDir, type VoicenoteConfig } from "./config.ts";
import { buildMarker, hasVoiceMarkup, parseMarkerId, stripMarkers } from "./marker.ts";
import { makeScript, type ScriptWriter } from "./script.ts";
import { createTranscriber, describeStt, modelSize, setupLocalStt, type SttDeps, type TranscriptionFile } from "./stt.ts";
import { synthesize as defaultSynthesize, type TtsSettings } from "./tts.ts";

export const PROVIDER_ID = "pi-telegram-voicenote";
export const REGISTRY_KEY = "__piTelegramVoiceSynthesisProviders__";
export const TRANSCRIPTION_REGISTRY_KEY = "__piTelegramVoiceTranscriptionProviders__";
const TELEGRAM_PREFIX = "[telegram]";
const CACHE_SIZE = 20;
const FINAL_STOP_REASONS = new Set(["stop", "length"]);

type SynthesisProvider = (text: string, options?: { lang?: string; rate?: string }) => Promise<string | undefined>;
type TranscriptionProvider = (file: TranscriptionFile, options?: { language?: string }) => Promise<string | undefined>;

interface TelegramCommandContext {
  args: string;
  reply: (text: string) => unknown;
}
interface TelegramCommandsModule {
  registerTelegramCommand?: (registration: {
    name: string;
    description?: string;
    handler: (ctx: TelegramCommandContext) => Promise<void>;
  }) => () => void;
}

export interface ExtensionDeps {
  configPath?: string;
  synthesize?: (text: string, settings: TtsSettings) => Promise<string>;
  importTelegramCommands?: () => Promise<TelegramCommandsModule>;
  stt?: SttDeps;
}

const USAGE = "Usage: /voicenote [on|off|status] · /voicenote stt auto|openai|faster-whisper|off · /voicenote setup-stt";

const TELEGRAM_COMMANDS_MODULE = "@llblab/pi-telegram/commands";

function globalRegistry<T>(key: string): Map<string, T> {
  const global = globalThis as Record<string, unknown>;
  const existing = global[key];
  if (existing instanceof Map) return existing as Map<string, T>;
  const created = new Map<string, T>();
  global[key] = created;
  return created;
}

const providerRegistry = () => globalRegistry<SynthesisProvider>(REGISTRY_KEY);
const transcriptionRegistry = () => globalRegistry<TranscriptionProvider>(TRANSCRIPTION_REGISTRY_KEY);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function createExtension(deps: ExtensionDeps = {}) {
  const path = deps.configPath ?? defaultConfigPath();
  const synthesize = deps.synthesize ?? defaultSynthesize;
  const importTelegramCommands =
    deps.importTelegramCommands ?? (() => import(TELEGRAM_COMMANDS_MODULE) as Promise<TelegramCommandsModule>);
  const sttDeps: SttDeps = { venvDir: sttVenvDir(), ...deps.stt };

  return function voicenote(pi: ExtensionAPI): void {
    let config: VoicenoteConfig = loadConfig(path).config;
    let ctx: ExtensionContext | undefined;
    let telegramTurn = false;
    let provider: SynthesisProvider | undefined;
    let transcriber: TranscriptionProvider | undefined;
    let disposeTelegramCommand: (() => void) | undefined;
    const replies = new Map<string, string>();

    const warn = (message: string) => {
      if (ctx?.hasUI) ctx.ui.notify(message, "warning");
      else console.warn(message);
    };

    let setupRunning = false;

    const setupStt = async (confirmed: boolean, say: (text: string) => unknown): Promise<string> => {
      config = loadConfig(path).config;
      const venvDir = sttDeps.venvDir!;
      const model = config.sttLocalModel;
      if (!confirmed) {
        return `This installs local speech-to-text: a Python environment in ${venvDir}, the faster-whisper package, and the "${model}" model (${modelSize(model)}). Nothing leaves this machine when transcribing. Send /voicenote setup-stt confirm to proceed.`;
      }
      if (setupRunning) return "Local speech-to-text setup is already running.";
      setupRunning = true;
      try {
        const python = await setupLocalStt({ venvDir, model, run: sttDeps.runPython, progress: (m) => { void say(m); } });
        return `faster-whisper is ready (${python}). Voice notes you send are now transcribed locally when no OPENAI_API_KEY is set.`;
      } catch (error) {
        return `Local speech-to-text setup failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        setupRunning = false;
      }
    };

    const handleCommand = async (args: string, say: (text: string) => unknown): Promise<string> => {
      const [sub = "", value = ""] = args.trim().toLowerCase().split(/\s+/);
      if (sub === "setup-stt") return setupStt(value === "confirm", say);
      if (sub === "stt") {
        const engine = parseSttEngine(value);
        if (!engine) return "Usage: /voicenote stt auto|openai|faster-whisper|off";
        config = { ...loadConfig(path).config, sttEngine: engine };
        saveConfig({ sttEngine: engine }, path);
        return status();
      }
      if (sub === "on" || sub === "off") {
        config = { ...config, enabled: sub === "on" };
        saveConfig({ enabled: config.enabled }, path);
      } else if (sub && sub !== "status") {
        return USAGE;
      }
      return status();
    };

    const status = (): string => {
      const writer = config.scriptMode === "plain" ? "plain cleanup" : `model ${config.model ?? "(current)"}`;
      return `Voice notes: ${config.enabled ? "on" : "off"} · voice ${config.voice} · script by ${writer} · voice input: ${describeStt(config, sttDeps)}`;
    };

    const scriptWriter = (): ScriptWriter | undefined => {
      if (!ctx) return undefined;
      const registry = ctx.modelRegistry;
      let model = ctx.model;
      if (config.model) {
        const slash = config.model.indexOf("/");
        const found = registry.find(config.model.slice(0, slash), config.model.slice(slash + 1));
        if (found) model = found;
        else warn(`telegram-voicenote: model ${config.model} not found; using the current model`);
      }
      if (!model) return undefined;
      const chosen = model;
      return async (systemPrompt, reply, signal) => {
        const response = await registry.complete(
          chosen,
          { systemPrompt, messages: [{ role: "user", content: reply, timestamp: Date.now() }] },
          { signal },
        );
        if (response.stopReason === "error" || response.stopReason === "aborted") {
          throw new Error(response.errorMessage ?? response.stopReason);
        }
        return textOf(response.content);
      };
    };

    const narrate: SynthesisProvider = async (text) => {
      const id = parseMarkerId(text);
      if (!id) return undefined;
      const reply = replies.get(id);
      if (reply === undefined) return undefined;
      try {
        const script = await makeScript(reply, config, scriptWriter(), (reason) => warn(`telegram-voicenote: ${reason}; using plain text`));
        return await synthesize(script, config);
      } catch (error) {
        warn(`telegram-voicenote: voice note failed (${error instanceof Error ? error.message : String(error)})`);
        return undefined;
      }
    };

    pi.on("session_start", async (_event, startCtx) => {
      ctx = startCtx;
      const loaded = loadConfig(path);
      config = loaded.config;
      if (loaded.warning) warn(loaded.warning);
      provider = narrate;
      providerRegistry().set(PROVIDER_ID, provider);
      // Settings are re-read per voice note so /voicenote and file edits apply at once.
      transcriber = createTranscriber(() => loadConfig(path).config, sttDeps);
      transcriptionRegistry().set(PROVIDER_ID, transcriber);
      if (!disposeTelegramCommand) {
        try {
          const mod = await importTelegramCommands();
          disposeTelegramCommand = mod.registerTelegramCommand?.({
            name: "voicenote",
            description: "Voice notes: on, off, status, stt <engine>, setup-stt",
            handler: async (command) => { await command.reply(await handleCommand(command.args, command.reply)); },
          });
        } catch {
          // pi-telegram's command API is optional; the Pi command still works.
        }
      }
    });

    pi.on("session_shutdown", async () => {
      const registry = providerRegistry();
      if (provider && registry.get(PROVIDER_ID) === provider) registry.delete(PROVIDER_ID);
      provider = undefined;
      const transcribers = transcriptionRegistry();
      if (transcriber && transcribers.get(PROVIDER_ID) === transcriber) transcribers.delete(PROVIDER_ID);
      transcriber = undefined;
      disposeTelegramCommand?.();
      disposeTelegramCommand = undefined;
    });

    pi.on("before_agent_start", async (event) => {
      telegramTurn = event.messageType === "user" && String(event.prompt ?? "").startsWith(TELEGRAM_PREFIX);
    });

    pi.on("message_end", async (event, endCtx) => {
      const message = event.message;
      if (message.role !== "assistant" || !telegramTurn) return;
      if (!FINAL_STOP_REASONS.has(message.stopReason)) return;
      ctx = endCtx;
      config = loadConfig(path).config;
      if (!config.enabled) return;
      const text = textOf(message.content);
      if (text.trim().length < config.minResponseChars || hasVoiceMarkup(text)) return;
      const id = randomUUID();
      replies.set(id, text);
      while (replies.size > CACHE_SIZE) replies.delete(replies.keys().next().value!);
      return { message: { ...message, content: [...message.content, { type: "text", text: `\n\n${buildMarker(id)}` }] } };
    });

    pi.on("context", async (event) => {
      const messages = stripMarkers(event.messages);
      return messages ? { messages } : undefined;
    });

    pi.registerCommand("voicenote", {
      description: "Telegram voice notes: on, off, status, stt <engine>, setup-stt",
      handler: async (args, commandCtx) => {
        const say = (text: string) => commandCtx.ui.notify(text, "info");
        say(await handleCommand(args, say));
      },
    });
  };
}

export default createExtension();
