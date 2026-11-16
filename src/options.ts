/**
 * Choices shared by the Pi wizard and the Telegram menus: presets, labels with
 * the current value, and the "✓" marker on the selected option.
 */

import type { SttEngine } from "./config.ts";

export interface Preset {
  value: string;
  /** Shown after the value, e.g. "Spanish". */
  note?: string;
}

export const VOICE_PRESETS: readonly Preset[] = [
  "es-AR-TomasNeural", "es-AR-ElenaNeural", "es-MX-DaliaNeural", "es-MX-JorgeNeural", "es-ES-AlvaroNeural",
  "es-ES-ElviraNeural", "es-CO-GonzaloNeural", "es-CO-SalomeNeural", "en-US-AriaNeural", "en-US-GuyNeural",
].map((value) => ({ value }));

export const RATE_PRESETS: readonly Preset[] = ["-20%", "-10%", "+0%", "+10%", "+20%", "+30%"].map((value) => ({ value }));

export const ENGINE_PRESETS: readonly (Preset & { value: SttEngine })[] = [
  { value: "auto", note: "OpenAI when a key is set, else local" },
  { value: "openai", note: "cloud, needs an OpenAI API key" },
  { value: "faster-whisper", note: "local, after installing it" },
  { value: "off", note: "do not transcribe voice notes" },
];

export const OPENAI_MODEL_PRESETS: readonly Preset[] = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"].map((value) => ({ value }));

export const LANGUAGE_PRESETS: readonly Preset[] = [
  { value: "auto", note: "detect" },
  { value: "es", note: "Spanish" },
  { value: "en", note: "English" },
  { value: "pt", note: "Portuguese" },
];

export const CURRENT_MARK = "✓ ";
export const OTHER = "Other…";

export interface Choice {
  label: string;
  /** undefined = "Other…" (ask for a custom value). */
  value: string | undefined;
}

const presetLabel = (preset: Preset) => (preset.note ? `${preset.value} — ${preset.note}` : preset.value);

/**
 * The presets with the current one marked. A current value that is not a preset
 * becomes its own marked entry after them; `other` adds a final "Other…".
 */
export function choiceList(presets: readonly Preset[], current: string, other: boolean): Choice[] {
  const choices: Choice[] = presets.map((preset) => ({
    label: `${preset.value === current ? CURRENT_MARK : ""}${presetLabel(preset)}`,
    value: preset.value,
  }));
  if (!presets.some((preset) => preset.value === current)) choices.push({ label: `${CURRENT_MARK}${current} (custom)`, value: current });
  if (other) choices.push({ label: OTHER, value: undefined });
  return choices;
}

/** A short sentence to hear the voice, in the voice's language when we know it. */
export function sampleText(voice: string, rate: string): string {
  const lang = voice.slice(0, 2).toLowerCase();
  if (lang === "es") return `Hola, esta es la voz ${voice} a velocidad ${rate}. Así sonarán tus notas de voz.`;
  if (lang === "pt") return `Olá, esta é a voz ${voice} na velocidade ${rate}. Assim vão soar as suas notas de voz.`;
  return `Hello, this is the voice ${voice} at rate ${rate}. This is how your voice notes will sound.`;
}
