import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTranscriber,
  LOCAL_SCRIPT,
  pickEngines,
  PREFETCH_SCRIPT,
  setupLocalStt,
  transcribeLocal,
  transcribeOpenAI,
  type SttSettings,
} from "../src/stt.ts";

const settings = (patch: Partial<SttSettings> = {}): SttSettings => ({
  sttEngine: "auto",
  sttOpenaiModel: "gpt-4o-mini-transcribe",
  sttLocalModel: "small",
  sttLanguage: "auto",
  sttTimeoutMs: 120_000,
  sttPython: undefined,
  ...patch,
});

function audioFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "voicenote-stt-"));
  const path = join(dir, "voice-1.ogg");
  writeFileSync(path, Buffer.from("OggS fake audio"));
  return path;
}

const voice = (path: string) => ({ path, fileName: "voice-1.ogg", mimeType: "audio/ogg", kind: "voice" });

test("auto prefers OpenAI when a key exists, then local", () => {
  assert.deepEqual(pickEngines("auto", { hasKey: true, hasLocal: true }), ["openai", "faster-whisper"]);
  assert.deepEqual(pickEngines("auto", { hasKey: false, hasLocal: true }), ["faster-whisper"]);
  assert.deepEqual(pickEngines("auto", { hasKey: true, hasLocal: false }), ["openai"]);
  assert.deepEqual(pickEngines("auto", { hasKey: false, hasLocal: false }), []);
});

test("an explicit engine is used only when it is available", () => {
  assert.deepEqual(pickEngines("openai", { hasKey: true, hasLocal: true }), ["openai"]);
  assert.deepEqual(pickEngines("openai", { hasKey: false, hasLocal: true }), []);
  assert.deepEqual(pickEngines("faster-whisper", { hasKey: true, hasLocal: true }), ["faster-whisper"]);
  assert.deepEqual(pickEngines("faster-whisper", { hasKey: true, hasLocal: false }), []);
  assert.deepEqual(pickEngines("off", { hasKey: true, hasLocal: true }), []);
});

test("OpenAI engine posts the audio as multipart and returns the text", async () => {
  const path = audioFile();
  const calls: any[] = [];
  const fetchStub = async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ text: " hola mundo " }), { status: 200 });
  };
  const text = await transcribeOpenAI(path, {
    apiKey: "sk-test", baseUrl: "https://api.example/v1/", model: "whisper-1", language: "es", timeoutMs: 5000, fetch: fetchStub as any,
  });
  assert.equal(text, "hola mundo");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example/v1/audio/transcriptions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  const form = calls[0].init.body as FormData;
  assert.equal(form.get("model"), "whisper-1");
  assert.equal(form.get("language"), "es");
  const file = form.get("file") as File;
  assert.equal(file.name, "voice-1.ogg");
  assert.equal(await file.text(), "OggS fake audio");
});

test("OpenAI engine omits language on auto and reports HTTP errors", async () => {
  const path = audioFile();
  let form: FormData | undefined;
  const fetchStub = async (_url: any, init: any) => {
    form = init.body;
    return new Response("invalid key", { status: 401 });
  };
  await assert.rejects(
    transcribeOpenAI(path, { apiKey: "k", baseUrl: "https://api.openai.com/v1", model: "m", language: undefined, timeoutMs: 5000, fetch: fetchStub as any }),
    /HTTP 401: invalid key/,
  );
  assert.equal(form!.get("language"), null);
});

test("local engine runs the faster-whisper script with model and language", async () => {
  const calls: any[] = [];
  const text = await transcribeLocal("/a/voice.ogg", {
    python: "/venv/bin/python", model: "small", language: undefined, timeoutMs: 1000,
    run: async (bin, args, timeoutMs) => { calls.push({ bin, args, timeoutMs }); return '{"text": " buenas ", "language": "es"}\n'; },
  });
  assert.equal(text, "buenas");
  assert.deepEqual(calls, [{ bin: "/venv/bin/python", args: ["-c", LOCAL_SCRIPT, "/a/voice.ogg", "small", ""], timeoutMs: 1000 }]);
  assert.match(LOCAL_SCRIPT, /from faster_whisper import WhisperModel/);
});

test("transcriber: auto with a key uses OpenAI and returns its text", async () => {
  const path = audioFile();
  const transcribe = createTranscriber(() => settings(), {
    env: { OPENAI_API_KEY: "sk" },
    fetch: (async () => new Response('{"text":"desde la nube"}')) as any,
    exists: () => false,
    venvDir: "/nowhere",
  });
  assert.equal(await transcribe(voice(path)), "desde la nube");
});

test("transcriber: auto without a key uses the local venv python", async () => {
  const runs: string[] = [];
  const transcribe = createTranscriber(() => settings({ sttLanguage: "es" }), {
    env: {},
    exists: (p) => p === join("/venv", "bin", "python"),
    venvDir: "/venv",
    runPython: async (bin, args) => { runs.push(`${bin} ${args.slice(2).join(" ")}`); return '{"text":"local"}'; },
  });
  assert.equal(await transcribe(voice("/a/v.ogg")), "local");
  assert.deepEqual(runs, [`${join("/venv", "bin", "python")} /a/v.ogg small es`]);
});

test("transcriber: falls back to local when OpenAI fails", async () => {
  const transcribe = createTranscriber(() => settings(), {
    env: { OPENAI_API_KEY: "sk" },
    fetch: (async () => new Response("down", { status: 503 })) as any,
    exists: () => true,
    venvDir: "/venv",
    runPython: async () => '{"text":"respaldo"}',
  });
  assert.equal(await transcribe(voice(audioFile())), "respaldo");
});

test("transcriber: without any engine returns a notice telling how to configure it", async () => {
  const transcribe = createTranscriber(() => settings(), { env: {}, exists: () => false, venvDir: "/venv" });
  const notice = await transcribe(voice("/a/v.ogg"));
  assert.equal(
    notice,
    "[Voice note not transcribed: no speech-to-text engine is configured. Set OPENAI_API_KEY for cloud transcription, or run /voicenote setup-stt to install local faster-whisper. Audio file: /a/v.ogg]",
  );
});

test("transcriber: when every engine fails returns a notice with the reasons", async () => {
  const transcribe = createTranscriber(() => settings(), {
    env: { OPENAI_API_KEY: "sk" },
    fetch: (async () => new Response("down", { status: 503 })) as any,
    exists: () => true,
    venvDir: "/venv",
    runPython: async () => { throw new Error("model missing"); },
  });
  const path = audioFile();
  assert.equal(
    await transcribe(voice(path)),
    `[Voice note not transcribed: openai: HTTP 503: down; faster-whisper: model missing. Audio file: ${path}]`,
  );
});

test("transcriber: off, or a file that is not audio, is left to other handlers", async () => {
  let called = false;
  const deps = { env: { OPENAI_API_KEY: "sk" }, fetch: (async () => { called = true; return new Response('{"text":"x"}'); }) as any, exists: () => true, venvDir: "/v" };
  assert.equal(await createTranscriber(() => settings({ sttEngine: "off" }), deps)(voice("/a/v.ogg")), undefined);
  assert.equal(
    await createTranscriber(() => settings(), deps)({ path: "/a/doc.pdf", fileName: "doc.pdf", mimeType: "application/pdf", kind: "document" }),
    undefined,
  );
  assert.equal(called, false);
});

test("transcriber: an explicit sttPython is used instead of the venv", async () => {
  const bins: string[] = [];
  const transcribe = createTranscriber(() => settings({ sttEngine: "faster-whisper", sttPython: "/opt/py" }), {
    env: {}, exists: (p) => p === "/opt/py", venvDir: "/venv",
    runPython: async (bin) => { bins.push(bin); return '{"text":"ok"}'; },
  });
  assert.equal(await transcribe(voice("/a/v.ogg")), "ok");
  assert.deepEqual(bins, ["/opt/py"]);
});

test("setupLocalStt creates the venv, installs faster-whisper and prefetches the model", async () => {
  const runs: string[] = [];
  const progress: string[] = [];
  const python = await setupLocalStt({
    venvDir: "/venv", model: "small", basePython: "python3",
    run: async (bin, args) => { runs.push([bin, ...args.filter((a) => a !== PREFETCH_SCRIPT)].join(" ")); return "ok\n"; },
    progress: (m) => progress.push(m),
  });
  const py = join("/venv", "bin", "python");
  assert.equal(python, py);
  assert.deepEqual(runs, [
    "python3 -m venv /venv",
    `${py} -m pip install --upgrade faster-whisper`,
    `${py} -c small`,
  ]);
  assert.deepEqual(progress, [
    "Creating a Python environment in /venv…",
    "Installing faster-whisper (pip)…",
    "Downloading the faster-whisper model \"small\" (first time only)…",
  ]);
  assert.match(PREFETCH_SCRIPT, /WhisperModel\(sys\.argv\[1\]/);
});

test("setupLocalStt stops at the first failing step", async () => {
  const runs: string[] = [];
  await assert.rejects(
    setupLocalStt({ venvDir: "/venv", model: "small", run: async (bin, args) => { runs.push(args[1]!); throw new Error("No module named venv"); } }),
    /creating the Python environment failed: No module named venv/,
  );
  assert.equal(runs.length, 1);
});
