/**
 * Text to Telegram-ready voice: a speech engine produces audio bytes (Edge TTS
 * by default), ffmpeg converts them to OGG/Opus mono.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TtsSettings {
  voice: string;
  rate: string;
  ffmpegPath: string;
}

/** Synthesizes one chunk of already XML-escaped text to audio bytes (any format ffmpeg reads). */
export type SpeechEngine = (text: string, options: { voice: string; rate: string }) => Promise<Uint8Array>;

export type FfmpegRunner = (bin: string, args: string[]) => Promise<void>;

export interface TtsDeps {
  engine?: SpeechEngine;
  runFfmpeg?: FfmpegRunner;
  dir?: string;
}

/** Edge TTS rejects very long requests; split well below its limit. */
const MAX_CHUNK_CHARS = 2500;
const STALE_FILE_MS = 60 * 60 * 1000;

export const DEFAULT_TTS_DIR = join(tmpdir(), "pi-telegram-voicenote");

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Splits at sentence ends, then at spaces, then hard, so every chunk fits `max`. */
export function splitText(text: string, max = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (!piece) return;
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= max) current += ` ${piece}`;
    else {
      chunks.push(current);
      current = piece;
    }
  };
  for (const sentence of text.trim().split(/(?<=[.!?…])\s+/)) {
    if (sentence.length <= max) push(sentence);
    else for (const word of sentence.split(/\s+/)) {
      for (let i = 0; i < word.length; i += max) push(word.slice(i, i + max));
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export const edgeEngine: SpeechEngine = async (text, { voice, rate }) => {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate });
    const parts: Buffer[] = [];
    for await (const part of audioStream) parts.push(Buffer.from(part as Uint8Array));
    const audio = Buffer.concat(parts);
    if (!audio.length) throw new Error("Edge TTS returned no audio");
    return audio;
  } finally {
    tts.close();
  }
};

export const spawnFfmpeg: FfmpegRunner = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
    child.on("error", (error) => reject(new Error(`could not run ${bin}: ${error.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} exited with ${code}: ${stderr.trim().split("\n").at(-1) ?? ""}`)));
  });

async function pruneStale(dir: string): Promise<void> {
  try {
    const now = Date.now();
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      if (now - (await stat(path)).mtimeMs > STALE_FILE_MS) await rm(path, { force: true });
    }
  } catch {
    // best effort
  }
}

/** Returns the path of an OGG/Opus voice note for `text`. */
export async function synthesize(text: string, settings: TtsSettings, deps: TtsDeps = {}): Promise<string> {
  const { engine = edgeEngine, runFfmpeg = spawnFfmpeg, dir = DEFAULT_TTS_DIR } = deps;
  const chunks = splitText(text);
  if (!chunks.length) throw new Error("nothing to synthesize: empty script");
  await mkdir(dir, { recursive: true });
  await pruneStale(dir);
  const audio: Uint8Array[] = [];
  for (const chunk of chunks) audio.push(await engine(escapeXml(chunk), { voice: settings.voice, rate: settings.rate }));
  const base = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}`);
  const input = `${base}.mp3`;
  const output = `${base}.ogg`;
  // MP3 frames concatenate cleanly, so chunks become one input stream.
  await writeFile(input, Buffer.concat(audio));
  try {
    await runFfmpeg(settings.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", input,
      "-vn", "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", output,
    ]);
  } finally {
    await rm(input, { force: true });
  }
  return output;
}
