/**
 * Companion-owned settings in <agent-dir>/telegram-voicenote.json.
 * Every value has a safe default; a broken file never throws.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ScriptMode } from "./script.ts";

export interface VoicenoteConfig {
  enabled: boolean;
  scriptMode: ScriptMode;
  /** "provider/id"; undefined = the session's current model. */
  model: string | undefined;
  maxScriptWords: number;
  scriptTimeoutMs: number;
  language: string;
  style: string;
  voice: string;
  rate: string;
  minResponseChars: number;
  ffmpegPath: string;
  /** Speech-to-text for incoming voice notes. */
  sttEngine: SttEngine;
  sttOpenaiModel: string;
  /** faster-whisper model name or Hugging Face repo id. */
  sttLocalModel: string;
  /** ISO code such as "es", or "auto" to let the engine detect it. */
  sttLanguage: string;
  sttTimeoutMs: number;
  /** Python with faster-whisper; undefined = the plugin's own venv. */
  sttPython: string | undefined;
}

export const STT_ENGINES = ["auto", "openai", "faster-whisper", "off"] as const;
export type SttEngine = (typeof STT_ENGINES)[number];

/** Accepts the canonical names plus "local" as an alias of faster-whisper. */
export function parseSttEngine(value: unknown): SttEngine | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "local") return "faster-whisper";
  return (STT_ENGINES as readonly string[]).includes(v) ? (v as SttEngine) : undefined;
}

export const DEFAULT_CONFIG: Readonly<VoicenoteConfig> = Object.freeze({
  enabled: true,
  scriptMode: "llm",
  model: undefined,
  maxScriptWords: 180,
  scriptTimeoutMs: 90_000,
  language: "auto",
  style: "",
  voice: "es-MX-DaliaNeural",
  rate: "+0%",
  minResponseChars: 1,
  ffmpegPath: "ffmpeg",
  sttEngine: "auto",
  sttOpenaiModel: "gpt-4o-mini-transcribe",
  sttLocalModel: "small",
  sttLanguage: "auto",
  sttTimeoutMs: 120_000,
  sttPython: undefined,
});

function agentDir(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.PI_CODING_AGENT_DIR?.trim();
  return override
    ? override === "~" || override.startsWith("~/") ? join(home, override.slice(1)) : override
    : join(home, ".pi", "agent");
}

export function configPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(agentDir(env, home), "telegram-voicenote.json");
}

/** The Python venv that `/voicenote setup-stt` creates for faster-whisper. */
export function sttVenvDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(agentDir(env, home), "telegram-voicenote", "stt-venv");
}

const clampInt = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

const str = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const matching = (value: unknown, pattern: RegExp, fallback: string): string =>
  typeof value === "string" && pattern.test(value.trim()) ? value.trim() : fallback;

export function normalizeConfig(raw: Record<string, unknown>): VoicenoteConfig {
  const d = DEFAULT_CONFIG;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    scriptMode: raw.scriptMode === "plain" || raw.scriptMode === "llm" ? raw.scriptMode : d.scriptMode,
    model: typeof raw.model === "string" && /^[^/\s]+\/\S+$/.test(raw.model.trim()) ? raw.model.trim() : undefined,
    maxScriptWords: clampInt(raw.maxScriptWords, d.maxScriptWords, 20, 2000),
    scriptTimeoutMs: clampInt(raw.scriptTimeoutMs, d.scriptTimeoutMs, 5000, 600_000),
    language: str(raw.language, d.language),
    style: typeof raw.style === "string" ? raw.style.trim() : d.style,
    // Both end up inside SSML attributes: allow only safe characters.
    voice: matching(raw.voice, /^[A-Za-z0-9-]+$/, d.voice),
    rate: matching(raw.rate, /^[+-]\d{1,3}%$/, d.rate),
    minResponseChars: clampInt(raw.minResponseChars, d.minResponseChars, 1, 1_000_000),
    ffmpegPath: str(raw.ffmpegPath, d.ffmpegPath),
    sttEngine: parseSttEngine(raw.sttEngine) ?? d.sttEngine,
    sttOpenaiModel: matching(raw.sttOpenaiModel, /^[A-Za-z0-9._:-]+$/, d.sttOpenaiModel),
    // Passed as a process argument and a Hugging Face id: keep it to safe characters.
    sttLocalModel: matching(raw.sttLocalModel, /^[A-Za-z0-9._\/-]+$/, d.sttLocalModel),
    sttLanguage: str(raw.sttLanguage, d.sttLanguage),
    sttTimeoutMs: clampInt(raw.sttTimeoutMs, d.sttTimeoutMs, 10_000, 1_800_000),
    sttPython: typeof raw.sttPython === "string" && raw.sttPython.trim() ? raw.sttPython.trim() : undefined,
  };
}

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function loadConfig(path = configPath()): { config: VoicenoteConfig; warning?: string } {
  try {
    return { config: normalizeConfig(readRaw(path)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { config: { ...DEFAULT_CONFIG }, warning: `telegram-voicenote: ignoring ${path} (${reason}); using defaults` };
  }
}

/** Merges `patch` into the file, keeping unknown keys. A broken file is replaced. */
export function saveConfig(patch: Partial<VoicenoteConfig>, path = configPath()): void {
  let raw: Record<string, unknown> = {};
  try {
    raw = readRaw(path);
  } catch {
    raw = {};
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...raw, ...patch }, null, 2)}\n`);
}
