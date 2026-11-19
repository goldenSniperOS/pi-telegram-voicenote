import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtension, PROVIDER_ID, REGISTRY_KEY, TRANSCRIPTION_REGISTRY_KEY, type ExtensionDeps } from "../src/index.ts";
import { buildMarker } from "../src/marker.ts";
import { SETUP_STARTED, USAGE } from "../src/commands.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Handler = (event: any, ctx: any) => unknown;
type Provider = (text: string, options?: { lang?: string; rate?: string }) => Promise<string | undefined>;

function registry(): Map<string, Provider> {
  return (globalThis as any)[REGISTRY_KEY];
}

async function setup(fileConfig: Record<string, unknown> = {}, overrides: Partial<ExtensionDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "voicenote-index-"));
  const configPath = join(dir, "telegram-voicenote.json");
  writeFileSync(configPath, JSON.stringify(fileConfig));
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, any>();
  const telegramCommands: any[] = [];
  const completions: any[] = [];
  const spoken: string[] = [];
  const notes: string[] = [];
  const pi = {
    on: (name: string, h: Handler) => handlers.set(name, h),
    registerCommand: (name: string, opts: any) => commands.set(name, opts),
  };
  const ctx = {
    hasUI: true,
    ui: { notify: (m: string) => notes.push(m) },
    model: { provider: "cur", id: "model" },
    modelRegistry: {
      find: (provider: string, id: string) => (provider === "alt" ? { provider, id } : undefined),
      complete: async (model: any, context: any, options: any) => {
        completions.push({ model, context, options });
        return { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Narrated script." }] };
      },
    },
  };
  createExtension({
    configPath,
    // Never read the real ~/.pi/agent key file from tests.
    secretsPath: join(dir, "telegram-voicenote.secrets.json"),
    synthesize: async (text) => { spoken.push(text); return "/tmp/voice.ogg"; },
    importTelegramCommands: async () => ({ registerTelegramCommand: (r: any) => { telegramCommands.push(r); return () => {}; } }),
    ...overrides,
  })(pi as any);
  const emit = (name: string, event: any = {}) => handlers.get(name)!({ type: name, ...event }, ctx);
  await emit("session_start", { reason: "startup" });
  return { configPath, handlers, commands, telegramCommands, completions, spoken, notes, ctx, emit };
}

const assistant = (text: string, stopReason = "stop") => ({
  role: "assistant", stopReason, content: [{ type: "text", text }],
});

async function telegramReply(env: Awaited<ReturnType<typeof setup>>, text = "| a | b |\n|---|---|\n| 1 | 2 |") {
  await env.emit("before_agent_start", { messageType: "user", prompt: "[telegram]\nhello" });
  return (await env.emit("message_end", { message: assistant(text) })) as any;
}

function markerText(result: any): string {
  return result.message.content.at(-1).text.trim();
}

test("Telegram turn gets the marker appended and the provider narrates it", async () => {
  const env = await setup();
  const result = await telegramReply(env);
  assert.ok(result?.message);
  assert.equal(result.message.content[0].text, "| a | b |\n|---|---|\n| 1 | 2 |");
  const marker = markerText(result);
  assert.match(marker, /^<!-- telegram_voice \{"text":"@pi-telegram-voicenote:[\w-]+"\} -->$/);
  const sentinel = JSON.parse(marker.slice(marker.indexOf("{"), marker.lastIndexOf("}") + 1)).text;
  const provider = registry().get(PROVIDER_ID)!;
  assert.equal(await provider(sentinel), "/tmp/voice.ogg");
  assert.deepEqual(env.spoken, ["Narrated script."]);
  const call = env.completions[0];
  assert.deepEqual(call.model, { provider: "cur", id: "model" });
  assert.match(call.context.systemPrompt, /Maximum 180 words/);
  assert.equal(call.context.messages[0].content, "| a | b |\n|---|---|\n| 1 | 2 |");
  assert.ok(call.options.signal instanceof AbortSignal);
});

test("configured model is resolved through the registry", async () => {
  const env = await setup({ model: "alt/small" });
  const sentinel = JSON.parse(markerText(await telegramReply(env)).match(/\{.*\}/)![0]).text;
  await registry().get(PROVIDER_ID)!(sentinel);
  assert.deepEqual(env.completions[0].model, { provider: "alt", id: "small" });
});

test("terminal turns, tool calls, errors and existing voice markup are untouched", async () => {
  const env = await setup();
  await env.emit("before_agent_start", { messageType: "user", prompt: "hello from terminal" });
  assert.equal(await env.emit("message_end", { message: assistant("hi") }), undefined);
  await env.emit("before_agent_start", { messageType: "user", prompt: "[telegram]\nhi" });
  for (const reason of ["toolUse", "error", "aborted"]) {
    assert.equal(await env.emit("message_end", { message: assistant("partial", reason) }), undefined);
  }
  assert.equal(await env.emit("message_end", { message: { role: "user", content: "x" } }), undefined);
  assert.equal(await env.emit("message_end", { message: assistant('x <!-- telegram_voice {"text":"y"} -->') }), undefined);
  await env.emit("before_agent_start", { messageType: "custom", message: {} });
  assert.equal(await env.emit("message_end", { message: assistant("hi") }), undefined);
});

test("minResponseChars and disabled config skip the marker", async () => {
  const env = await setup({ minResponseChars: 50 });
  assert.equal(await telegramReply(env, "short"), undefined);
  const off = await setup({ enabled: false });
  assert.equal(await telegramReply(off), undefined);
});

test("provider ignores foreign text and unknown ids", async () => {
  await setup();
  const provider = registry().get(PROVIDER_ID)!;
  assert.equal(await provider("Hello, speak this"), undefined);
  assert.equal(await provider("@pi-telegram-voicenote:missing"), undefined);
});

test("provider returns undefined and notifies when synthesis fails", async () => {
  const env = await setup({}, { synthesize: async () => { throw new Error("tts down"); } });
  const sentinel = JSON.parse(markerText(await telegramReply(env)).match(/\{.*\}/)![0]).text;
  assert.equal(await registry().get(PROVIDER_ID)!(sentinel), undefined);
  assert.ok(env.notes.some((n) => /tts down/.test(n)));
});

test("context hook strips our marker so the model never sees it", async () => {
  const env = await setup();
  const messages = [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "text", text: "A" }, { type: "text", text: `\n\n${buildMarker("id-1")}` }] }];
  const result: any = await env.emit("context", { messages });
  assert.deepEqual(result.messages[1].content, [{ type: "text", text: "A" }]);
  assert.equal(await env.emit("context", { messages: [{ role: "user", content: "q" }] }), undefined);
});

test("/voicenote toggles and persists; Telegram command is registered", async () => {
  const env = await setup();
  const cmd = env.commands.get("voicenote");
  await cmd.handler("off", env.ctx);
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).enabled, false);
  assert.equal(await telegramReply(env), undefined);
  await cmd.handler("on", env.ctx);
  assert.ok(await telegramReply(env));
  await cmd.handler("status", env.ctx);
  assert.match(env.notes.at(-1)!, /on/);
  assert.equal(env.telegramCommands[0].name, "voicenote");
  const replies: string[] = [];
  await env.telegramCommands[0].handler({ name: "voicenote", args: "off", reply: (t: string) => replies.push(t), enqueuePrompt: async () => {} });
  assert.match(replies[0]!, /off/);
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).enabled, false);
});

test("session_shutdown unregisters only our own provider", async () => {
  const env = await setup();
  assert.ok(registry().has(PROVIDER_ID));
  await env.emit("session_shutdown", { reason: "quit" });
  assert.equal(registry().has(PROVIDER_ID), false);
  const other: Provider = async () => undefined;
  const env2 = await setup();
  registry().set(PROVIDER_ID, other);
  await env2.emit("session_shutdown", { reason: "quit" });
  assert.equal(registry().get(PROVIDER_ID), other);
  registry().delete(PROVIDER_ID);
});

test("a transcription provider is registered and transcribes Telegram voice notes", async () => {
  const env = await setup({}, {
    stt: { env: { OPENAI_API_KEY: "sk" }, fetch: (async () => new Response('{"text":"hola desde telegram"}')) as any, exists: () => false, venvDir: "/none" },
  });
  const transcribers: Map<string, any> = (globalThis as any)[TRANSCRIPTION_REGISTRY_KEY];
  const transcribe = transcribers.get(PROVIDER_ID);
  const dir = mkdtempSync(join(tmpdir(), "voicenote-in-"));
  writeFileSync(join(dir, "v.ogg"), "OggS");
  assert.equal(await transcribe({ path: join(dir, "v.ogg"), mimeType: "audio/ogg", kind: "voice" }, {}), "hola desde telegram");
  await env.emit("session_shutdown", { reason: "quit" });
  assert.equal(transcribers.has(PROVIDER_ID), false);
});

test("/voicenote status reports the speech-to-text engine in use", async () => {
  const env = await setup({}, { stt: { env: {}, exists: () => false, venvDir: "/none" } });
  await env.commands.get("voicenote").handler("status", env.ctx);
  assert.match(env.notes.at(-1)!, /voice input: auto → not configured/);
  const cloud = await setup({}, { stt: { env: { OPENAI_API_KEY: "sk" }, exists: () => false, venvDir: "/none" } });
  await cloud.commands.get("voicenote").handler("status", cloud.ctx);
  assert.match(cloud.notes.at(-1)!, /voice input: auto → openai \(gpt-4o-mini-transcribe\)/);
});

test("/voicenote stt <engine> switches and persists the voice input engine", async () => {
  const env = await setup({}, { stt: { env: { OPENAI_API_KEY: "sk" }, exists: () => true, venvDir: "/venv" } });
  const cmd = env.commands.get("voicenote");
  await cmd.handler("stt local", env.ctx);
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).sttEngine, "faster-whisper");
  assert.match(env.notes.at(-1)!, /voice input: faster-whisper → faster-whisper \(small\)/);
  await cmd.handler("stt off", env.ctx);
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).sttEngine, "off");
  assert.match(env.notes.at(-1)!, /voice input: off/);
  await cmd.handler("stt whisperx", env.ctx);
  assert.equal(env.notes.at(-1), "Usage: /voicenote stt auto|openai|faster-whisper|off");
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).sttEngine, "off");
});

test("/voicenote setup-stt explains first and installs only with confirm", async () => {
  const runs: string[][] = [];
  const venvDir = join(mkdtempSync(join(tmpdir(), "voicenote-venv-")), "stt-venv");
  const env = await setup({}, { stt: { env: {}, venvDir, exists: () => false, runPython: async (bin, args) => { runs.push([bin, ...args]); return "ok"; } } });
  const cmd = env.commands.get("voicenote");
  await cmd.handler("setup-stt", env.ctx);
  assert.equal(runs.length, 0);
  assert.equal(
    env.notes.at(-1),
    `This installs local speech-to-text: a Python environment in ${venvDir}, the faster-whisper package, and the "small" model (about 460 MB). Nothing leaves this machine when transcribing. Send /voicenote setup-stt confirm to proceed.`,
  );
  await cmd.handler("setup-stt confirm", env.ctx);
  assert.equal(runs.length, 3);
  assert.equal(env.notes.at(-1), `faster-whisper is ready (${join(venvDir, "bin", "python")}). Voice notes you send are now transcribed locally when no OPENAI_API_KEY is set.`);
});

test("Telegram /voicenote setup-stt confirm answers at once; progress and the result follow", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const venvDir = join(mkdtempSync(join(tmpdir(), "voicenote-venv-")), "stt-venv");
  const env = await setup({}, { stt: { env: {}, venvDir, exists: () => false, runPython: async () => { await gate; throw new Error("pip exploded"); } } });
  const replies: string[] = [];
  const send = (args: string) => env.telegramCommands[0].handler({ name: "voicenote", args, reply: (t: string) => replies.push(t), enqueuePrompt: async () => {} });
  await send("setup-stt confirm");
  assert.deepEqual(replies, [SETUP_STARTED]);
  await settle();
  await send("setup-stt confirm");
  assert.deepEqual(replies, [SETUP_STARTED, `Creating a Python environment in ${venvDir}…`, "Local speech-to-text setup is already running."]);
  release();
  await settle();
  assert.deepEqual(replies.slice(3), ["Local speech-to-text setup failed: creating the Python environment failed: pip exploded"]);
  assert.equal(SETUP_STARTED, "Installing local speech-to-text in the background. Progress and the result will arrive here.");
});

test("a Telegram reply that fails while reporting setup progress does not crash Pi", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const venvDir = join(mkdtempSync(join(tmpdir(), "voicenote-venv-")), "stt-venv");
    const env = await setup({}, { stt: { env: {}, venvDir, exists: () => false, runPython: async () => "ok" } });
    const replies: string[] = [];
    await env.telegramCommands[0].handler({
      name: "voicenote", args: "setup-stt confirm", enqueuePrompt: async () => {},
      reply: async (t: string) => { replies.push(t); if (t !== SETUP_STARTED) throw new Error("telegram down"); },
    });
    await settle();
    assert.equal(replies.length, 5);
    assert.match(replies.at(-1)!, /^faster-whisper is ready/);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test("/voicenote subcommands that take no value reject extra words and change nothing", async () => {
  const env = await setup({ enabled: false });
  const cmd = env.commands.get("voicenote");
  for (const args of ["on extra", "off now", "status please", "test 2", "menu x"]) {
    await cmd.handler(args, env.ctx);
    assert.equal(env.notes.at(-1), `/voicenote ${args.split(" ")[0]} takes no arguments. ${USAGE}`);
  }
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).enabled, false);
  const replies: string[] = [];
  await env.telegramCommands[0].handler({ name: "voicenote", args: "on please", reply: (t: string) => replies.push(t), enqueuePrompt: async () => {} });
  assert.deepEqual(replies, [`/voicenote on takes no arguments. ${USAGE}`]);
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).enabled, false);
  await cmd.handler("on", env.ctx);
  assert.equal(JSON.parse(readFileSync(env.configPath, "utf8")).enabled, true);
});
