/**
 * `/voicenote` in the Pi terminal: an interactive menu built on ctx.ui.select,
 * input and confirm. Every entry shows its current value; every change is saved
 * at once and the menu re-renders. The OpenAI API key is entered only here.
 */

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { parseOpenaiModel, parseSttLanguage, parseVoice, type VoicenoteConfig } from "./config.ts";
import {
  choiceList,
  ENGINE_PRESETS,
  LANGUAGE_PRESETS,
  OPENAI_MODEL_PRESETS,
  RATE_PRESETS,
  VOICE_PRESETS,
  type Choice,
} from "./options.ts";
import { validateApiKey } from "./secrets.ts";

export type WizardUI = Pick<ExtensionUIContext, "select" | "input" | "confirm" | "notify">;

/** What the menus need from the extension; implemented in index.ts. */
export interface VoicenoteController {
  /** Fresh settings from the file. */
  config(): VoicenoteConfig;
  /** Saves `patch` and applies it at once. */
  update(patch: Partial<VoicenoteConfig>): void;
  status(): string;
  /** e.g. "auto → openai (gpt-4o-mini-transcribe)". */
  sttSummary(): string;
  /** "set (env)", "set (saved)" or "not set". */
  keyState(): string;
  /** Whether a key is saved in the secrets file (whatever the environment says). */
  hasSavedKey(): boolean;
  saveKey(key: string): void;
  deleteKey(): boolean;
  secretsPath: string;
  localInstalled(): boolean;
  setupExplanation(): string;
  setupStt(say: (text: string) => unknown): Promise<string>;
  /** Starts setup without waiting; progress and the result go to `say`. False when one is already running. */
  startSetupStt(say: (text: string) => unknown): boolean;
  /** Synthesizes a short sample with the current voice and rate; returns the OGG path. */
  testVoice(): Promise<string>;
}

const DONE = "Done";

/** The main menu entries, each with its current value. Shared with Telegram. */
export function menuEntries(c: VoicenoteController) {
  const config = c.config();
  return {
    toggle: `Voice replies: ${config.enabled ? "on" : "off"}`,
    voice: `Voice: ${config.voice}`,
    rate: `Rate: ${config.rate}`,
    engine: `Voice input: ${c.sttSummary()}`,
    key: `OpenAI API key: ${c.keyState()}`,
    model: `OpenAI model: ${config.sttOpenaiModel}`,
    language: `Audio language: ${config.sttLanguage}`,
    install: `Local engine (faster-whisper): ${c.localInstalled() ? "installed" : "not installed"}`,
    test: "Test voice",
  };
}

type Action = keyof ReturnType<typeof menuEntries>;

async function choose(ui: WizardUI, title: string, choices: Choice[]): Promise<Choice | undefined> {
  const label = await ui.select(title, choices.map((choice) => choice.label));
  return choices.find((choice) => choice.label === label);
}

/** Picks from presets, or asks for a custom value on "Other…". Returns undefined when cancelled or invalid. */
async function pickValue(
  ui: WizardUI,
  title: string,
  choices: Choice[],
  custom?: { prompt: string; placeholder: string; parse: (value: string) => string | undefined; invalid: string },
): Promise<string | undefined> {
  const choice = await choose(ui, title, choices);
  if (!choice) return undefined;
  if (choice.value !== undefined) return choice.value;
  if (!custom) return undefined;
  const typed = await ui.input(custom.prompt, custom.placeholder);
  if (typed === undefined || !typed.trim()) return undefined;
  const parsed = custom.parse(typed);
  if (!parsed) ui.notify(custom.invalid, "warning");
  return parsed;
}

/** Paste, replace or delete the saved OpenAI API key. Also opened by `/voicenote key` in Pi. */
export async function runKeyMenu(ui: WizardUI, c: VoicenoteController): Promise<void> {
  const state = c.keyState();
  const saved = c.hasSavedKey();
  const title = state === "set (env)"
    ? "OpenAI API key — OPENAI_API_KEY is set in Pi's environment and wins over a saved key"
    : `OpenAI API key — ${state}`;
  const choices: Choice[] = saved
    ? [{ label: "Replace the saved key", value: "paste" }, { label: "Delete the saved key", value: "delete" }]
    : [{ label: "Paste a key", value: "paste" }];
  const choice = await choose(ui, title, choices);
  if (choice?.value === "paste") {
    const typed = await ui.input(
      "OpenAI API key — WARNING: what you paste here is visible on screen. It is saved only on this machine (mode 0600).",
      "sk-…",
    );
    if (typed === undefined) return;
    const result = validateApiKey(typed);
    if ("error" in result) {
      ui.notify(result.error, "warning");
      return;
    }
    c.saveKey(result.key);
    ui.notify(`OpenAI API key saved to ${c.secretsPath} (readable only by you).`, "info");
  } else if (choice?.value === "delete") {
    if (await ui.confirm("Delete the saved OpenAI API key?", `It is removed from ${c.secretsPath}.`)) {
      c.deleteKey();
      ui.notify("Saved OpenAI API key deleted.", "info");
    }
  }
}

async function act(action: Action, ui: WizardUI, c: VoicenoteController): Promise<void> {
  const config = c.config();
  switch (action) {
    case "toggle":
      c.update({ enabled: !config.enabled });
      return;
    case "voice": {
      const voice = await pickValue(ui, `Voice — current: ${config.voice}`, choiceList(VOICE_PRESETS, config.voice, true), {
        prompt: "Edge TTS voice name", placeholder: "es-AR-TomasNeural", parse: parseVoice,
        invalid: "Not a valid voice name (letters, digits and dashes, e.g. es-AR-TomasNeural); voice unchanged.",
      });
      if (voice) c.update({ voice });
      return;
    }
    case "rate": {
      const rate = await pickValue(ui, `Rate — current: ${config.rate}`, choiceList(RATE_PRESETS, config.rate, false));
      if (rate) c.update({ rate });
      return;
    }
    case "engine": {
      const engine = await pickValue(ui, `Voice input — current: ${c.sttSummary()}`, choiceList(ENGINE_PRESETS, config.sttEngine, false));
      if (engine) c.update({ sttEngine: engine as VoicenoteConfig["sttEngine"] });
      return;
    }
    case "key":
      return runKeyMenu(ui, c);
    case "model": {
      const model = await pickValue(ui, `OpenAI model — current: ${config.sttOpenaiModel}`, choiceList(OPENAI_MODEL_PRESETS, config.sttOpenaiModel, true), {
        prompt: "OpenAI transcription model", placeholder: "gpt-4o-transcribe", parse: parseOpenaiModel,
        invalid: "Not a valid model name (letters, digits, . _ : -); model unchanged.",
      });
      if (model) c.update({ sttOpenaiModel: model });
      return;
    }
    case "language": {
      const language = await pickValue(ui, `Audio language — current: ${config.sttLanguage}`, choiceList(LANGUAGE_PRESETS, config.sttLanguage, true), {
        prompt: "Language code of your voice notes", placeholder: "fr", parse: parseSttLanguage,
        invalid: "Not a valid language code (e.g. es, en, pt-BR, or auto); language unchanged.",
      });
      if (language) c.update({ sttLanguage: language });
      return;
    }
    case "install":
      if (await ui.confirm("Install local speech-to-text (faster-whisper)?", c.setupExplanation())) {
        ui.notify(await c.setupStt((text) => ui.notify(text, "info")), "info");
      }
      return;
    case "test":
      try {
        const path = await c.testVoice();
        ui.notify(`Test voice note (${config.voice}, ${config.rate}): ${path}`, "info");
      } catch (error) {
        ui.notify(`Test voice failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
      return;
  }
}

/** Runs the menu until the user picks Done or cancels. */
export async function runWizard(ui: WizardUI, c: VoicenoteController): Promise<void> {
  for (;;) {
    const entries = menuEntries(c);
    const labels = [...Object.values(entries), DONE];
    const picked = await ui.select(`Voice notes — ${c.status()}`, labels);
    const action = (Object.keys(entries) as Action[]).find((key) => entries[key] === picked);
    if (!action) return;
    await act(action, ui, c);
  }
}
