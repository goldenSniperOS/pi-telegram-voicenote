/**
 * `/voicenote <subcommand>`: one text handler for the Pi terminal and Telegram.
 * Without a subcommand Telegram gets a numbered menu with current values and
 * the exact commands to send. The API key is never accepted here: typed
 * arguments end up in chat or command history.
 */

import { parseOpenaiModel, parseRate, parseSttEngine, parseSttLanguage, parseVoice, type VoicenoteConfig } from "./config.ts";
import {
  choiceList,
  ENGINE_PRESETS,
  LANGUAGE_PRESETS,
  OPENAI_MODEL_PRESETS,
  RATE_PRESETS,
  VOICE_PRESETS,
  type Preset,
} from "./options.ts";
import { menuEntries, type VoicenoteController } from "./wizard.ts";

export interface CommandIO {
  surface: "pi" | "telegram";
  say: (text: string) => unknown;
  /** Telegram: queues a prompt as if the user had sent it (pi-telegram command context). */
  enqueuePrompt?: (prompt: string) => Promise<void>;
  /** Telegram: whether the 🎙 Voice notes section with buttons is registered. */
  sectionAvailable?: boolean;
}

export const SETUP_STARTED = "Installing local speech-to-text in the background. Progress and the result will arrive here.";
export const SETUP_ALREADY_RUNNING = "Local speech-to-text setup is already running.";

/** Sends a message without letting a failed delivery (sync throw or rejection) escape. */
export function sayQuietly(say: (text: string) => unknown, text: string): void {
  try {
    void Promise.resolve(say(text)).catch(() => {});
  } catch {
    // A progress line that cannot be delivered is not worth failing the setup.
  }
}

const NO_VALUE_COMMANDS = new Set(["on", "off", "status", "test", "menu"]);

export const USAGE =
  "Usage: /voicenote [menu|on|off|status|test] · /voicenote voice|rate|stt|model|lang <value> · /voicenote setup-stt";

const KEY_COMMANDS = new Set(["key", "apikey", "api-key", "openai-key"]);

export const KEY_WHERE = "Paste it in the Pi terminal (/voicenote → OpenAI API key), or set OPENAI_API_KEY in Pi's environment.";

export function keyRefusal(state: string, typedSomething: boolean): string {
  return [
    "For safety the OpenAI API key cannot be entered from Telegram, so it never stays in the chat history.",
    KEY_WHERE,
    `OpenAI key: ${state}.`,
    typedSomething ? "Nothing was saved. If you sent a real key here, delete that message and consider rotating the key." : "",
  ].filter(Boolean).join(" ");
}

const LANGUAGE_NAMES: Record<string, string> = { es: "Spanish", en: "English", pt: "Portuguese" };

/** A Telegram turn whose reply exercises the real voice note path. */
export function testPrompt(voice: string): string {
  const language = LANGUAGE_NAMES[voice.slice(0, 2).toLowerCase()];
  return `This is a voice note test requested with /voicenote test. Reply with one short, friendly sentence${language ? ` in ${language}` : ""} confirming that voice replies work. Do not use tools.`;
}

interface Setting {
  key: keyof VoicenoteConfig;
  title: string;
  command: string;
  presets: readonly Preset[];
  parse: (value: string) => string | undefined;
  invalid: string;
  example: string;
  /** A valid value that is not a preset, for the "Other" hint. */
  other?: string;
}

const SETTINGS: Record<string, Setting> = {
  voice: {
    key: "voice", title: "Voice", command: "voice", presets: VOICE_PRESETS, parse: parseVoice, example: "es-AR-TomasNeural", other: "en-GB-SoniaNeural",
    invalid: "Not a valid voice name (letters, digits and dashes, e.g. es-AR-TomasNeural).",
  },
  rate: {
    key: "rate", title: "Rate", command: "rate", presets: RATE_PRESETS, parse: parseRate, example: "+10%",
    invalid: "Not a valid rate (e.g. +10% or -10%, up to three digits).",
  },
  model: {
    key: "sttOpenaiModel", title: "OpenAI model", command: "model", presets: OPENAI_MODEL_PRESETS, parse: parseOpenaiModel, example: "gpt-4o-transcribe", other: "gpt-4o-transcribe-diarize",
    invalid: "Not a valid OpenAI model name (letters, digits, . _ : -).",
  },
  lang: {
    key: "sttLanguage", title: "Audio language", command: "lang", presets: LANGUAGE_PRESETS, parse: parseSttLanguage, example: "es", other: "fr",
    invalid: "Not a valid language code (e.g. es, en, pt-BR, or auto).",
  },
};
SETTINGS.language = SETTINGS.lang!;

/** "Voice — current: X" plus one line per choice with the command that selects it. */
function listChoices(title: string, command: string, presets: readonly Preset[], current: string, custom: string | undefined): string {
  const lines = choiceList(presets, current, false).map((choice) =>
    choice.label.startsWith("✓ ") ? choice.label : `${choice.label} → /voicenote ${command} ${choice.value}`);
  return [`${title} — current: ${current}`, ...lines, custom ?? ""].filter(Boolean).join("\n");
}

/** The numbered menu for Telegram (and Pi without a UI). */
export function textMenu(c: VoicenoteController, sectionAvailable: boolean): string {
  const e = menuEntries(c);
  const config = c.config();
  const items: Array<[string, string]> = [
    [e.toggle, config.enabled ? "/voicenote off" : "/voicenote on"],
    [e.voice, "/voicenote voice <name> (list: /voicenote voice)"],
    [e.rate, "/voicenote rate +10% (list: /voicenote rate)"],
    [e.engine, "/voicenote stt auto|openai|faster-whisper|off"],
    [e.key, `Pi terminal only: /voicenote → OpenAI API key, or OPENAI_API_KEY`],
    [e.model, "/voicenote model <name> (list: /voicenote model)"],
    [e.language, "/voicenote lang es|en|pt|auto (list: /voicenote lang)"],
    [e.install, "/voicenote setup-stt"],
    [e.test, "/voicenote test"],
  ];
  return [
    "🎙 Voice notes",
    c.status(),
    "",
    ...items.map(([label, command], i) => `${i + 1}. ${label} — ${command}`),
    ...(sectionAvailable ? ["", "With buttons: open the bot menu → 🎙 Voice notes."] : []),
  ].join("\n");
}

async function runTest(c: VoicenoteController, io: CommandIO): Promise<string> {
  const config = c.config();
  if (io.surface === "telegram") {
    if (!config.enabled) return "Voice replies are off. Turn them on first with /voicenote on, then send /voicenote test.";
    if (io.enqueuePrompt) {
      await io.enqueuePrompt(testPrompt(config.voice));
      return `Voice test queued: the next reply arrives with a voice note (voice ${config.voice}, rate ${config.rate}).`;
    }
  }
  try {
    const path = await c.testVoice();
    return io.surface === "telegram"
      ? `Sample synthesized on the Pi machine (${path}), but this command cannot send audio to Telegram. Send any message to hear voice ${config.voice}.`
      : `Test voice note (${config.voice}, ${config.rate}): ${path}`;
  } catch (error) {
    return `Test voice failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function runCommand(args: string, c: VoicenoteController, io: CommandIO): Promise<string> {
  const trimmed = args.trim();
  const rawSub = trimmed.split(/\s+/, 1)[0] ?? "";
  const sub = rawSub.toLowerCase();
  // Everything after the subcommand, so "voice es AR" is rejected instead of read as "es".
  const value = trimmed.slice(rawSub.length).trim();

  if (KEY_COMMANDS.has(sub)) {
    if (io.surface === "telegram") return keyRefusal(c.keyState(), value !== "");
    if (/^(delete|remove)$/i.test(value)) {
      return c.deleteKey() ? "Saved OpenAI API key deleted." : "No saved OpenAI API key to delete.";
    }
    return `${value ? "Keys typed as command arguments are not saved (they can end up in history). " : ""}${KEY_WHERE} OpenAI key: ${c.keyState()}.`;
  }
  if (sub === "setup-stt") {
    if (value.toLowerCase() !== "confirm") return `${c.setupExplanation()} Send /voicenote setup-stt confirm to proceed.`;
    // Telegram runs one command at a time; a minutes-long install must not hold the handler.
    if (io.surface === "telegram") return c.startSetupStt(io.say) ? SETUP_STARTED : SETUP_ALREADY_RUNNING;
    return c.setupStt(io.say);
  }
  if (sub === "stt") {
    const current = c.config().sttEngine;
    if (!value) return listChoices("Voice input", "stt", ENGINE_PRESETS, current, undefined);
    const engine = parseSttEngine(value);
    if (!engine) return "Usage: /voicenote stt auto|openai|faster-whisper|off";
    c.update({ sttEngine: engine });
    return c.status();
  }
  const setting = SETTINGS[sub];
  if (setting) {
    const current = String(c.config()[setting.key]);
    const custom = setting.other ? `Other: /voicenote ${setting.command} <value>, e.g. ${setting.other}` : undefined;
    if (!value) return listChoices(setting.title, setting.command, setting.presets, current, custom);
    const parsed = setting.parse(value);
    if (!parsed) return `${setting.invalid} Usage: /voicenote ${setting.command} ${setting.example}`;
    c.update({ [setting.key]: parsed } as Partial<VoicenoteConfig>);
    return c.status();
  }
  if (NO_VALUE_COMMANDS.has(sub) && value) return `/voicenote ${sub} takes no arguments. ${USAGE}`;
  if (sub === "test") return runTest(c, io);
  if (sub === "on" || sub === "off") {
    c.update({ enabled: sub === "on" });
    return c.status();
  }
  if (sub === "menu" || (sub === "" && io.surface === "telegram")) return textMenu(c, Boolean(io.sectionAvailable));
  if (sub === "" || sub === "status") return c.status();
  return USAGE;
}
