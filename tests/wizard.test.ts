import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtension, type ExtensionDeps } from "../src/index.ts";

type Answer = string | undefined | ((title: string, options: string[]) => string | undefined);

/** Picks the option that starts with `prefix`; fails loudly when it is missing. */
const pick = (prefix: string): Answer => (title, options) => {
  const found = options.find((o) => o.startsWith(prefix));
  if (!found) throw new Error(`no option starting with ${JSON.stringify(prefix)} in "${title}": ${JSON.stringify(options)}`);
  return found;
};

interface Script {
  select?: Answer[];
  input?: Array<string | undefined>;
  confirm?: boolean[];
}

async function setup(
  fileConfig: Record<string, unknown> = {},
  overrides: Partial<ExtensionDeps> = {},
  options: { hasUI?: boolean; env?: NodeJS.ProcessEnv; installed?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "voicenote-wizard-"));
  const configPath = join(dir, "telegram-voicenote.json");
  const keyPath = join(dir, "telegram-voicenote.secrets.json");
  writeFileSync(configPath, JSON.stringify(fileConfig));
  const handlers = new Map<string, any>();
  const commands = new Map<string, any>();
  const spoken: Array<{ text: string; voice: string; rate: string }> = [];
  const runs: string[][] = [];
  const pi = { on: (name: string, h: any) => handlers.set(name, h), registerCommand: (name: string, o: any) => commands.set(name, o) };
  createExtension({
    configPath,
    secretsPath: keyPath,
    synthesize: async (text, settings) => { spoken.push({ text, voice: settings.voice, rate: settings.rate }); return "/tmp/sample.ogg"; },
    importTelegramCommands: async () => ({}),
    stt: {
      env: options.env ?? {},
      venvDir: join(dir, "venv"),
      exists: () => options.installed ?? false,
      runPython: async (bin, args) => { runs.push([bin, ...args]); return "ok"; },
    },
    ...overrides,
  })(pi as any);
  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, { hasUI: true, ui: { notify() {} } });

  const selects: Array<{ title: string; options: string[] }> = [];
  const inputs: Array<{ title: string; placeholder?: string }> = [];
  const confirms: Array<{ title: string; message: string }> = [];
  const notes: Array<{ message: string; type?: string }> = [];

  async function run(args: string, script: Script = {}) {
    const selectQueue = [...(script.select ?? [])];
    const inputQueue = [...(script.input ?? [])];
    const confirmQueue = [...(script.confirm ?? [])];
    const ui = {
      notify: (message: string, type?: string) => notes.push({ message, type }),
      select: async (title: string, opts: string[]) => {
        selects.push({ title, options: opts });
        if (selects.length > 60) throw new Error("menu loop did not end");
        const next = selectQueue.shift();
        return typeof next === "function" ? next(title, opts) : next;
      },
      input: async (title: string, placeholder?: string) => { inputs.push({ title, placeholder }); return inputQueue.shift(); },
      confirm: async (title: string, message: string) => { confirms.push({ title, message }); return confirmQueue.shift() ?? false; },
    };
    await commands.get("voicenote").handler(args, { hasUI: options.hasUI ?? true, ui });
  }

  const file = () => JSON.parse(readFileSync(configPath, "utf8"));
  /** Every string the wizard showed: titles, options, prompts and notifications. */
  const shown = () => [
    ...selects.flatMap((s) => [s.title, ...s.options]),
    ...inputs.flatMap((i) => [i.title, i.placeholder ?? ""]),
    ...confirms.flatMap((c) => [c.title, c.message]),
    ...notes.map((n) => n.message),
  ].join("\n");
  return { configPath, keyPath, run, file, selects, inputs, confirms, notes, spoken, runs, shown };
}

test("/voicenote with no arguments opens the menu with the status and every current value", async () => {
  const env = await setup();
  await env.run("", { select: [pick("Done")] });
  assert.equal(env.selects.length, 1);
  const menu = env.selects[0]!;
  assert.match(menu.title, /Voice notes: on/);
  assert.match(menu.title, /OpenAI key: not set/);
  assert.deepEqual(menu.options, [
    "Voice replies: on",
    "Voice: es-MX-DaliaNeural",
    "Rate: +0%",
    "Voice input: auto → not configured",
    "OpenAI API key: not set",
    "OpenAI model: gpt-4o-mini-transcribe",
    "Audio language: auto",
    "Local engine (faster-whisper): not installed",
    "Test voice",
    "Done",
  ]);
  assert.deepEqual(env.file(), {});
});

test("/voicenote menu opens the same menu; cancelling closes it", async () => {
  const env = await setup();
  await env.run("menu", { select: [undefined] });
  assert.equal(env.selects.length, 1);
  assert.equal(env.selects[0]!.options.at(-1), "Done");
});

test("without a UI, /voicenote prints the status as before", async () => {
  const env = await setup({}, {}, { hasUI: false });
  await env.run("");
  assert.equal(env.selects.length, 0);
  assert.match(env.notes.at(-1)!.message, /^Voice notes: on · voice es-MX-DaliaNeural/);
  assert.match(env.notes.at(-1)!.message, /OpenAI key: not set/);
});

test("existing subcommands do not open the menu", async () => {
  const env = await setup();
  await env.run("off");
  await env.run("status");
  await env.run("stt openai");
  assert.equal(env.selects.length, 0);
  assert.deepEqual(env.file(), { enabled: false, sttEngine: "openai" });
});

test("toggling voice replies persists and the menu re-renders with the new value", async () => {
  const env = await setup();
  await env.run("", { select: [pick("Voice replies: on"), pick("Voice replies: off"), pick("Done")] });
  assert.equal(env.file().enabled, true);
  assert.equal(env.selects[1]!.options[0], "Voice replies: off");
  assert.match(env.selects[1]!.title, /Voice notes: off/);
  assert.equal(env.selects[2]!.options[0], "Voice replies: on");
});

test("voice: presets with the current one marked, then the new value shows in the menu", async () => {
  const env = await setup();
  await env.run("", { select: [pick("Voice:"), pick("es-AR-TomasNeural"), pick("Done")] });
  const list = env.selects[1]!.options;
  for (const voice of ["es-AR-TomasNeural", "es-AR-ElenaNeural", "es-MX-JorgeNeural", "es-ES-AlvaroNeural", "es-ES-ElviraNeural",
    "es-CO-GonzaloNeural", "es-CO-SalomeNeural", "en-US-AriaNeural", "en-US-GuyNeural"]) {
    assert.ok(list.includes(voice), `${voice} missing from ${JSON.stringify(list)}`);
  }
  assert.ok(list.includes("✓ es-MX-DaliaNeural"));
  assert.equal(list.filter((o) => o.startsWith("✓ ")).length, 1);
  assert.equal(list.at(-1), "Other…");
  assert.equal(env.file().voice, "es-AR-TomasNeural");
  assert.equal(env.selects[2]!.options[1], "Voice: es-AR-TomasNeural");
});

test("voice: a custom value is its own marked entry; Other… validates the name", async () => {
  const env = await setup({ voice: "en-GB-SoniaNeural" });
  await env.run("", {
    select: [pick("Voice:"), pick("Other…"), pick("Voice:"), pick("Other…"), pick("Done")],
    input: ["bad voice!", " en-GB-RyanNeural "],
  });
  assert.ok(env.selects[1]!.options.includes("✓ en-GB-SoniaNeural (custom)"));
  assert.ok(env.notes.some((n) => n.type === "warning" && /voice/i.test(n.message)));
  assert.equal(env.file().voice, "en-GB-RyanNeural");
  assert.equal(env.selects.at(-1)!.options[1], "Voice: en-GB-RyanNeural");
});

test("rate: presets with the current one marked; a custom rate shows marked", async () => {
  const env = await setup();
  await env.run("", { select: [pick("Rate:"), pick("+10%"), pick("Done")] });
  assert.deepEqual(env.selects[1]!.options, ["-20%", "-10%", "✓ +0%", "+10%", "+20%", "+30%"]);
  assert.equal(env.file().rate, "+10%");
  assert.equal(env.selects[2]!.options[2], "Rate: +10%");
  const custom = await setup({ rate: "+15%" });
  await custom.run("", { select: [pick("Rate:"), undefined, pick("Done")] });
  assert.ok(custom.selects[1]!.options.includes("✓ +15% (custom)"));
  assert.deepEqual(custom.file(), { rate: "+15%" });
});

test("voice input engine: auto, openai, faster-whisper, off with the current one marked", async () => {
  const env = await setup({}, {}, { installed: true });
  await env.run("", { select: [pick("Voice input:"), pick("faster-whisper"), pick("Done")] });
  const list = env.selects[1]!.options;
  assert.equal(list.length, 4);
  assert.match(list[0]!, /^✓ auto/);
  assert.match(list[1]!, /^openai/);
  assert.match(list[2]!, /^faster-whisper/);
  assert.match(list[3]!, /^off/);
  assert.equal(env.file().sttEngine, "faster-whisper");
  assert.equal(env.selects[2]!.options[3], "Voice input: faster-whisper → faster-whisper (small)");
  assert.equal(env.selects[2]!.options[7], "Local engine (faster-whisper): installed");
});

test("OpenAI model: presets, Other… validated, current marked", async () => {
  const env = await setup();
  await env.run("", {
    select: [pick("OpenAI model:"), pick("Other…"), pick("OpenAI model:"), pick("gpt-4o-transcribe"), pick("Done")],
    input: ["bad model;rm"],
  });
  assert.deepEqual(env.selects[1]!.options, ["gpt-4o-transcribe", "✓ gpt-4o-mini-transcribe", "whisper-1", "Other…"]);
  assert.ok(env.notes.some((n) => n.type === "warning" && /model/i.test(n.message)));
  assert.equal(env.file().sttOpenaiModel, "gpt-4o-transcribe");
  assert.equal(env.selects.at(-1)!.options[5], "OpenAI model: gpt-4o-transcribe");
});

test("audio language: presets, Other… validated, custom marked", async () => {
  const env = await setup();
  await env.run("", {
    select: [pick("Audio language:"), pick("es"), pick("Audio language:"), pick("Other…"), pick("Audio language:"), pick("Other…"), pick("Audio language:"), undefined, pick("Done")],
    input: ["french!!", "fr"],
  });
  const first = env.selects[1]!.options;
  assert.match(first[0]!, /^✓ auto/);
  assert.ok(first.some((o) => o.startsWith("es")));
  assert.ok(first.some((o) => o.startsWith("en")));
  assert.ok(first.some((o) => o.startsWith("pt")));
  assert.equal(first.at(-1), "Other…");
  assert.ok(env.selects[3]!.options.some((o) => o.startsWith("✓ es")));
  assert.ok(env.notes.some((n) => n.type === "warning" && /language/i.test(n.message)));
  assert.equal(env.file().sttLanguage, "fr");
  assert.ok(env.selects[7]!.options.includes("✓ fr (custom)"));
  assert.equal(env.selects.at(-1)!.options[6], "Audio language: fr");
});

test("OpenAI API key: pasted key is saved 0600, warned as visible, never shown back", async () => {
  const key = "sk-proj-SECRET123abc";
  const env = await setup({}, {}, {});
  await env.run("", { select: [pick("OpenAI API key:"), pick("Paste"), pick("Done")], input: [`  ${key}  `] });
  assert.match(env.inputs[0]!.title, /visible/i);
  assert.deepEqual(JSON.parse(readFileSync(env.keyPath, "utf8")), { openaiApiKey: key });
  assert.equal(statSync(env.keyPath).mode & 0o777, 0o600);
  const menu = env.selects.at(-1)!;
  assert.equal(menu.options[4], "OpenAI API key: set (saved)");
  assert.match(menu.title, /OpenAI key: set \(saved\)/);
  assert.equal(menu.options[3], "Voice input: auto → openai (gpt-4o-mini-transcribe)");
  assert.doesNotMatch(env.shown(), /SECRET123/);
  assert.deepEqual(env.file(), {});
});

test("OpenAI API key: an invalid paste is rejected and the saved key stays", async () => {
  const env = await setup();
  writeFileSync(env.keyPath, JSON.stringify({ openaiApiKey: "sk-keep" }));
  chmodSync(env.keyPath, 0o600);
  await env.run("", { select: [pick("OpenAI API key:"), pick("Replace"), pick("Done")], input: ["sk has spaces HIDDEN"] });
  assert.ok(env.notes.some((n) => n.type === "warning"));
  assert.deepEqual(JSON.parse(readFileSync(env.keyPath, "utf8")), { openaiApiKey: "sk-keep" });
  assert.doesNotMatch(env.shown(), /HIDDEN|sk-keep/);
});

test("OpenAI API key: delete asks first and removes the saved key", async () => {
  const env = await setup();
  writeFileSync(env.keyPath, JSON.stringify({ openaiApiKey: "sk-delete-me" }));
  await env.run("", { select: [pick("OpenAI API key: set (saved)"), pick("Delete"), pick("OpenAI API key:"), pick("Delete"), pick("Done")], confirm: [false, true] });
  assert.equal(env.confirms.length, 2);
  assert.equal(env.selects[2]!.options[4], "OpenAI API key: set (saved)");
  assert.equal(env.selects.at(-1)!.options[4], "OpenAI API key: not set");
  assert.doesNotMatch(readFileSync(env.keyPath, "utf8"), /sk-delete-me/);
  assert.doesNotMatch(env.shown(), /sk-delete-me/);
});

test("OpenAI API key: the environment key is shown as set (env) and explained", async () => {
  const env = await setup({}, {}, { env: { OPENAI_API_KEY: "sk-from-env-XYZ" } });
  await env.run("", { select: [pick("OpenAI API key: set (env)"), undefined, pick("Done")] });
  assert.match(env.selects[1]!.title, /OPENAI_API_KEY/);
  assert.doesNotMatch(env.shown(), /sk-from-env-XYZ/);
  assert.equal(existsSync(env.keyPath), false);
});

test("/voicenote key in the Pi terminal opens the key dialog directly", async () => {
  const env = await setup();
  await env.run("key", { select: [pick("Paste")], input: ["sk-direct-KEY"] });
  assert.equal(env.selects.length, 1);
  assert.match(env.selects[0]!.title, /OpenAI API key/);
  assert.deepEqual(JSON.parse(readFileSync(env.keyPath, "utf8")), { openaiApiKey: "sk-direct-KEY" });
  assert.doesNotMatch(env.shown(), /sk-direct-KEY/);
});

test("install local engine asks for confirmation and runs setup only when confirmed", async () => {
  const env = await setup();
  await env.run("", { select: [pick("Local engine"), pick("Local engine"), pick("Done")], confirm: [false, true] });
  assert.equal(env.confirms.length, 2);
  assert.match(env.confirms[0]!.message, /faster-whisper/);
  assert.equal(env.runs.length, 3);
  assert.ok(env.notes.some((n) => /faster-whisper is ready/.test(n.message)));
});

test("test voice synthesizes a sample with the current voice and rate and reports the file", async () => {
  const env = await setup({ voice: "es-AR-TomasNeural", rate: "+10%" });
  await env.run("", { select: [pick("Test voice"), pick("Done")] });
  assert.equal(env.spoken.length, 1);
  assert.equal(env.spoken[0]!.voice, "es-AR-TomasNeural");
  assert.equal(env.spoken[0]!.rate, "+10%");
  assert.ok(env.spoken[0]!.text.length > 0);
  assert.ok(env.notes.some((n) => n.message.includes("/tmp/sample.ogg")));
});

test("test voice reports a synthesis failure", async () => {
  const env = await setup({}, { synthesize: async () => { throw new Error("edge down"); } });
  await env.run("", { select: [pick("Test voice"), pick("Done")] });
  assert.ok(env.notes.some((n) => n.type === "warning" && /edge down/.test(n.message)));
});
