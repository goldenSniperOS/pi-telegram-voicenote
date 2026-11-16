/**
 * Speech-to-text for incoming Telegram voice notes. pi-telegram calls our
 * transcription provider with the downloaded file; we try the configured
 * engines in order and return the text, or a short bracketed notice that tells
 * the agent (and so the user) why the audio could not be transcribed.
 *
 * Engines: OpenAI's transcription API (cloud, OPENAI_API_KEY) and
 * faster-whisper (local, a Python with the package installed).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SttEngine, VoicenoteConfig } from "./config.ts";

export type SttSettings = Pick<
  VoicenoteConfig,
  "sttEngine" | "sttOpenaiModel" | "sttLocalModel" | "sttLanguage" | "sttTimeoutMs" | "sttPython"
>;

export type ConcreteEngine = "openai" | "faster-whisper";

export interface TranscriptionFile {
  path: string;
  fileName?: string;
  mimeType?: string;
  kind?: string;
}

/** Runs `bin args...` and resolves with its stdout; rejects on a non-zero exit or timeout. */
export type PythonRunner = (bin: string, args: string[], timeoutMs: number) => Promise<string>;

export interface SttDeps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  runPython?: PythonRunner;
  exists?: (path: string) => boolean;
  /** Where `/voicenote setup-stt` puts the venv. */
  venvDir?: string;
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Prints {"text","language"} as JSON. argv: audio path, model, language ("" = detect). */
export const LOCAL_SCRIPT = `import json, sys
from faster_whisper import WhisperModel
path, model, language = sys.argv[1], sys.argv[2], sys.argv[3] or None
whisper = WhisperModel(model, device="auto", compute_type="int8")
segments, info = whisper.transcribe(path, language=language, vad_filter=True)
text = " ".join(segment.text.strip() for segment in segments).strip()
print(json.dumps({"text": text, "language": info.language}))
`;

const AUDIO_EXTENSIONS = /\.(ogg|oga|opus|mp3|m4a|mp4|wav|webm|flac|mpga|mpeg)$/i;

export function isAudio(file: TranscriptionFile): boolean {
  if (file.kind === "voice" || file.kind === "audio") return true;
  if (file.mimeType?.toLowerCase().startsWith("audio/")) return true;
  return AUDIO_EXTENSIONS.test(file.fileName ?? file.path);
}

/** Engines to try, in order. "auto" prefers the cloud when a key exists. */
export function pickEngines(engine: SttEngine, available: { hasKey: boolean; hasLocal: boolean }): ConcreteEngine[] {
  const result: ConcreteEngine[] = [];
  if ((engine === "auto" || engine === "openai") && available.hasKey) result.push("openai");
  if ((engine === "auto" || engine === "faster-whisper") && available.hasLocal) result.push("faster-whisper");
  return result;
}

export function venvPython(venvDir: string): string {
  return process.platform === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
}

const language = (value: string): string | undefined => (value.trim().toLowerCase() === "auto" ? undefined : value.trim());

export async function transcribeOpenAI(
  path: string,
  options: { apiKey: string; baseUrl: string; model: string; language: string | undefined; timeoutMs: number; fetch?: typeof fetch },
): Promise<string> {
  const form = new FormData();
  form.append("file", new File([await readFile(path)], basename(path)));
  form.append("model", options.model);
  if (options.language) form.append("language", options.language);
  form.append("response_format", "json");
  const response = await (options.fetch ?? fetch)(`${options.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.trim().slice(0, 200)}`);
  const text = (JSON.parse(body) as { text?: unknown }).text;
  if (typeof text !== "string") throw new Error("response has no text");
  return text.trim();
}

export const defaultRunPython: PythonRunner = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        const last = stderr.trim().split("\n").at(-1)?.trim();
        reject(new Error(last ? last.slice(0, 300) : `${basename(bin)} exited with code ${code}`));
      }
    });
  });

export async function transcribeLocal(
  path: string,
  options: { python: string; model: string; language: string | undefined; timeoutMs: number; run?: PythonRunner },
): Promise<string> {
  const run = options.run ?? defaultRunPython;
  const stdout = await run(options.python, ["-c", LOCAL_SCRIPT, path, options.model, options.language ?? ""], options.timeoutMs);
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const text = (JSON.parse(line) as { text?: unknown }).text;
  if (typeof text !== "string") throw new Error("faster-whisper printed no text");
  return text.trim();
}

function resolve(settings: SttSettings, deps: SttDeps) {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const python = settings.sttPython ?? venvPython(deps.venvDir ?? "");
  const hasLocal = Boolean(settings.sttPython || deps.venvDir) && exists(python);
  return { env, apiKey, python, engines: pickEngines(settings.sttEngine, { hasKey: Boolean(apiKey), hasLocal }) };
}

/** One line for `/voicenote status`, e.g. "auto → openai (gpt-4o-mini-transcribe)". */
export function describeStt(settings: SttSettings, deps: SttDeps = {}): string {
  if (settings.sttEngine === "off") return "off";
  const first = resolve(settings, deps).engines[0];
  const detail = !first
    ? "not configured"
    : first === "openai" ? `openai (${settings.sttOpenaiModel})` : `faster-whisper (${settings.sttLocalModel})`;
  return `${settings.sttEngine} → ${detail}`;
}

/** The pi-telegram transcription provider. Returns undefined for non-audio or when off. */
export function createTranscriber(getSettings: () => SttSettings, deps: SttDeps = {}) {
  return async (file: TranscriptionFile): Promise<string | undefined> => {
    const settings = getSettings();
    if (settings.sttEngine === "off" || !isAudio(file)) return undefined;
    const { env, apiKey, python, engines } = resolve(settings, deps);
    if (engines.length === 0) {
      return `[Voice note not transcribed: no speech-to-text engine is configured. Set OPENAI_API_KEY for cloud transcription, or run /voicenote setup-stt to install local faster-whisper. Audio file: ${file.path}]`;
    }
    const lang = language(settings.sttLanguage);
    const failures: string[] = [];
    for (const engine of engines) {
      try {
        const text = engine === "openai"
          ? await transcribeOpenAI(file.path, {
            apiKey, baseUrl: env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL, model: settings.sttOpenaiModel,
            language: lang, timeoutMs: settings.sttTimeoutMs, fetch: deps.fetch,
          })
          : await transcribeLocal(file.path, {
            python, model: settings.sttLocalModel, language: lang, timeoutMs: settings.sttTimeoutMs, run: deps.runPython,
          });
        if (text) return text;
        failures.push(`${engine}: no speech recognized`);
      } catch (error) {
        failures.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return `[Voice note not transcribed: ${failures.join("; ")}. Audio file: ${file.path}]`;
  };
}

/** Downloads the model into the Hugging Face cache so the first voice note is not slow. */
export const PREFETCH_SCRIPT = `import sys
from faster_whisper import WhisperModel
WhisperModel(sys.argv[1], device="auto", compute_type="int8")
print("ok")
`;

const MODEL_SIZES: Record<string, string> = {
  tiny: "about 75 MB", base: "about 140 MB", small: "about 460 MB", medium: "about 1.5 GB",
  "large-v3": "about 3 GB", "large-v3-turbo": "about 1.6 GB", turbo: "about 1.6 GB",
};

export const modelSize = (model: string): string => MODEL_SIZES[model] ?? "download size varies";

const SETUP_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Creates a plugin-owned venv, installs faster-whisper and prefetches `model`.
 * Only ever runs from an explicit `/voicenote setup-stt confirm`.
 */
export async function setupLocalStt(options: {
  venvDir: string;
  model: string;
  basePython?: string;
  run?: PythonRunner;
  progress?: (message: string) => void;
}): Promise<string> {
  const run = options.run ?? defaultRunPython;
  const python = venvPython(options.venvDir);
  const steps: Array<[string, string, string, string[]]> = [
    [`Creating a Python environment in ${options.venvDir}…`, "creating the Python environment",
      options.basePython ?? (process.platform === "win32" ? "python" : "python3"), ["-m", "venv", options.venvDir]],
    ["Installing faster-whisper (pip)…", "installing faster-whisper", python, ["-m", "pip", "install", "--upgrade", "faster-whisper"]],
    [`Downloading the faster-whisper model "${options.model}" (first time only)…`, "downloading the model",
      python, ["-c", PREFETCH_SCRIPT, options.model]],
  ];
  for (const [message, label, bin, args] of steps) {
    options.progress?.(message);
    try {
      await run(bin, args, SETUP_TIMEOUT_MS);
    } catch (error) {
      throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return python;
}
