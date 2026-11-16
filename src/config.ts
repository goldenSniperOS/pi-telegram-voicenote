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
});

export function configPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = override
    ? override === "~" || override.startsWith("~/") ? join(home, override.slice(1)) : override
    : join(home, ".pi", "agent");
  return join(agentDir, "telegram-voicenote.json");
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
