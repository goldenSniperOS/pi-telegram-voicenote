/**
 * The OpenAI API key pasted in the Pi wizard lives in its own file,
 * <agent-dir>/telegram-voicenote.secrets.json, mode 0600, never in the config.
 * OPENAI_API_KEY in the environment always wins over the saved key.
 *
 * Nothing here prints or logs the key; callers show only describeApiKey().
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ApiKeySource = "env" | "saved";

const FIELD = "openaiApiKey";

/** Trimmed, non-empty, no whitespace inside. The error never repeats the input. */
export function validateApiKey(raw: string): { key: string } | { error: string } {
  const key = raw.trim();
  if (!key) return { error: "The API key is empty; nothing was saved." };
  if (/\s/.test(key)) return { error: "That does not look like an API key (it contains spaces or line breaks); nothing was saved." };
  return { key };
}

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** The saved key, or undefined when missing, invalid or unreadable. Never throws. */
export function readSavedApiKey(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    const value = readRaw(path)[FIELD];
    if (typeof value !== "string") return undefined;
    const result = validateApiKey(value);
    return "key" in result ? result.key : undefined;
  } catch {
    return undefined;
  }
}

function writeSecrets(raw: Record<string, unknown>, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  // `mode` applies only when the file is created; tighten an existing one too.
  chmodSync(path, 0o600);
}

function readForWrite(path: string): Record<string, unknown> {
  try {
    return readRaw(path);
  } catch {
    return {};
  }
}

export function saveApiKey(key: string, path: string): void {
  writeSecrets({ ...readForWrite(path), [FIELD]: key }, path);
}

/** Removes the saved key; returns whether one was there. */
export function deleteSavedApiKey(path: string): boolean {
  if (!existsSync(path)) return false;
  const had = readSavedApiKey(path) !== undefined;
  const { [FIELD]: _removed, ...rest } = readForWrite(path);
  writeSecrets(rest, path);
  return had;
}

export function resolveApiKey(env: NodeJS.ProcessEnv, path: string | undefined): { key: string; source: ApiKeySource } | undefined {
  const fromEnv = env.OPENAI_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const saved = readSavedApiKey(path);
  return saved ? { key: saved, source: "saved" } : undefined;
}

/** "set (env)", "set (saved)" or "not set": the only way the key ever shows up. */
export function describeApiKey(env: NodeJS.ProcessEnv, path: string | undefined): string {
  const resolved = resolveApiKey(env, path);
  return resolved ? `set (${resolved.source})` : "not set";
}
