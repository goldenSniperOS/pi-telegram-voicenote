import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExtension, type ExtensionDeps } from "../src/index.ts";

async function setup(
  fileConfig: Record<string, unknown> = {},
  overrides: Partial<ExtensionDeps> = {},
  options: { sections?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "voicenote-telegram-"));
  const configPath = join(dir, "telegram-voicenote.json");
  const keyPath = join(dir, "telegram-voicenote.secrets.json");
  writeFileSync(configPath, JSON.stringify(fileConfig));
  const handlers = new Map<string, any>();
  const commands = new Map<string, any>();
  const telegramCommands: any[] = [];
  const sections: any[] = [];
  let sectionDisposed = false;
  const spoken: string[] = [];
  const notes: string[] = [];
  const pi = { on: (name: string, h: any) => handlers.set(name, h), registerCommand: (name: string, o: any) => commands.set(name, o) };
  createExtension({
    configPath,
    secretsPath: keyPath,
    synthesize: async (text) => { spoken.push(text); return "/tmp/sample.ogg"; },
    importTelegramCommands: async () => ({ registerTelegramCommand: (r: any) => { telegramCommands.push(r); return () => {}; } }),
    importTelegramSections: async () =>
      options.sections === false ? {} : { registerTelegramSection: (r: any) => { sections.push(r); return () => { sectionDisposed = true; }; } },
    stt: { env: {}, venvDir: join(dir, "venv"), exists: () => false, runPython: async () => "ok" },
    ...overrides,
  })(pi as any);
  const piCtx = { hasUI: false, ui: { notify: (m: string) => notes.push(m) } };
  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, piCtx);

  const prompts: string[] = [];
  async function telegram(args: string, opts: { noEnqueue?: boolean } = {}): Promise<string[]> {
    const replies: string[] = [];
    const ctx: any = { name: "voicenote", args, reply: async (t: string) => { replies.push(t); } };
    if (!opts.noEnqueue) ctx.enqueuePrompt = async (p: string) => { prompts.push(p); };
    await telegramCommands[0].handler(ctx);
    return replies;
  }
  async function piCommand(args: string): Promise<string> {
    await commands.get("voicenote").handler(args, piCtx);
    return notes.at(-1)!;
  }
  const file = () => readFileSync(configPath, "utf8");
  const shutdown = () => handlers.get("session_shutdown")({ type: "session_shutdown" }, piCtx);
  return { configPath, keyPath, telegram, piCommand, file, prompts, spoken, sections, shutdown, isSectionDisposed: () => sectionDisposed };
}

test("Telegram /voicenote replies with the status and a numbered menu showing current values and commands", async () => {
  const env = await setup({ voice: "es-AR-TomasNeural", sttLanguage: "es" });
  const [menu] = await env.telegram("");
  assert.match(menu!, /Voice notes: on · voice es-AR-TomasNeural/);
  const lines = menu!.split("\n");
  const expect = [
    ["1. Voice replies: on", "/voicenote off"],
    ["2. Voice: es-AR-TomasNeural", "/voicenote voice"],
    ["3. Rate: +0%", "/voicenote rate"],
    ["4. Voice input: auto → not configured", "/voicenote stt"],
    ["5. OpenAI API key: not set", "Pi terminal"],
    ["6. OpenAI model: gpt-4o-mini-transcribe", "/voicenote model"],
    ["7. Audio language: es", "/voicenote lang"],
    ["8. Local engine (faster-whisper): not installed", "/voicenote setup-stt"],
    ["9. Test voice", "/voicenote test"],
  ];
  for (const [label, command] of expect) {
    const line = lines.find((l) => l.startsWith(label!));
    assert.ok(line, `missing ${label} in\n${menu}`);
    assert.ok(line!.includes(command!), `${line} should mention ${command}`);
  }
  assert.match(menu!, /🎙 Voice notes/);
  const [again] = await env.telegram("menu");
  assert.equal(again, menu);
});

test("the Telegram menu re-renders with new values after a change", async () => {
  const env = await setup();
  await env.telegram("off");
  await env.telegram("voice es-CO-SalomeNeural");
  const [menu] = await env.telegram("");
  assert.match(menu!, /^1\. Voice replies: off .*\/voicenote on/m);
  assert.match(menu!, /^2\. Voice: es-CO-SalomeNeural/m);
});

test("voice, rate, model and lang subcommands persist in Pi and Telegram alike", async () => {
  const env = await setup();
  const [voiceReply] = await env.telegram("voice es-AR-TomasNeural");
  assert.match(voiceReply!, /voice es-AR-TomasNeural/);
  await env.telegram("rate 10%");
  await env.piCommand("model gpt-4o-transcribe");
  await env.piCommand("lang ES");
  assert.deepEqual(JSON.parse(env.file()), { voice: "es-AR-TomasNeural", rate: "+10%", sttOpenaiModel: "gpt-4o-transcribe", sttLanguage: "es" });
  await env.piCommand("language auto");
  await env.telegram("rate -20%");
  assert.equal(JSON.parse(env.file()).sttLanguage, "auto");
  assert.equal(JSON.parse(env.file()).rate, "-20%");
});

test("invalid values are rejected and leave the config file untouched", async () => {
  const env = await setup({ voice: "es-MX-DaliaNeural" });
  const before = env.file();
  for (const args of ["voice bad\"voice", "voice es AR", "rate fast", "rate +1000%", "model bad;rm", "lang french!!", "stt whisperx"]) {
    const [reply] = await env.telegram(args);
    assert.match(reply!, /Usage|not a valid|Not a valid/i, `${args} → ${reply}`);
    assert.equal(env.file(), before, `${args} changed the file`);
  }
  await env.piCommand("rate fast");
  assert.equal(env.file(), before);
});

test("a subcommand without a value lists the choices with the current one marked", async () => {
  const env = await setup({ voice: "en-GB-SoniaNeural", sttOpenaiModel: "whisper-1" });
  const [voices] = await env.telegram("voice");
  assert.match(voices!, /✓ en-GB-SoniaNeural \(custom\)/);
  assert.match(voices!, /\/voicenote voice es-AR-TomasNeural/);
  const [rates] = await env.telegram("rate");
  assert.match(rates!, /✓ \+0%/);
  const [models] = await env.telegram("model");
  assert.match(models!, /✓ whisper-1/);
  const [langs] = await env.telegram("lang");
  assert.match(langs!, /✓ auto/);
  const [engines] = await env.telegram("stt");
  assert.match(engines!, /✓ auto/);
  assert.equal(env.file(), JSON.stringify({ voice: "en-GB-SoniaNeural", sttOpenaiModel: "whisper-1" }));
});

test("Telegram never accepts an API key: it explains where to enter it, stores nothing and echoes nothing", async () => {
  const env = await setup();
  for (const args of ["key", "key sk-proj-LEAK1", "KEY set sk-proj-LEAK2", "apikey sk-proj-LEAK3", "api-key sk-proj-LEAK4", "openai-key sk-proj-LEAK5"]) {
    const replies = await env.telegram(args);
    const text = replies.join("\n");
    assert.match(text, /Pi terminal/, args);
    assert.match(text, /OPENAI_API_KEY/, args);
    assert.doesNotMatch(text, /LEAK/, args);
  }
  assert.equal(existsSync(env.keyPath), false);
  writeFileSync(env.keyPath, JSON.stringify({ openaiApiKey: "sk-original" }));
  const before = readFileSync(env.keyPath, "utf8");
  const replies = await env.telegram("key sk-proj-REPLACE");
  assert.equal(readFileSync(env.keyPath, "utf8"), before);
  assert.doesNotMatch(replies.join("\n"), /REPLACE|sk-original/);
  assert.match(replies.join("\n"), /set \(saved\)/);
});

test("in Pi, a key typed as a command argument is not saved either; key delete removes the saved one", async () => {
  const env = await setup();
  const reply = await env.piCommand("key sk-proj-TYPED");
  assert.doesNotMatch(reply, /TYPED/);
  assert.match(reply, /\/voicenote/);
  assert.equal(existsSync(env.keyPath), false);
  writeFileSync(env.keyPath, JSON.stringify({ openaiApiKey: "sk-saved" }));
  assert.match(await env.piCommand("key delete"), /deleted/i);
  assert.doesNotMatch(readFileSync(env.keyPath, "utf8"), /sk-saved/);
});

test("Telegram /voicenote test queues a short Telegram turn so a real voice note arrives", async () => {
  const env = await setup({ voice: "es-AR-TomasNeural" });
  const [reply] = await env.telegram("test");
  assert.equal(env.prompts.length, 1);
  assert.match(env.prompts[0]!, /test/i);
  assert.match(env.prompts[0]!, /Spanish/);
  assert.match(reply!, /es-AR-TomasNeural/);
  assert.equal(env.spoken.length, 0);
});

test("Telegram /voicenote test with voice replies off asks to turn them on first", async () => {
  const env = await setup({ enabled: false });
  const [reply] = await env.telegram("test");
  assert.equal(env.prompts.length, 0);
  assert.match(reply!, /\/voicenote on/);
});

test("Telegram /voicenote test without enqueuePrompt synthesizes locally and says so honestly", async () => {
  const env = await setup();
  const [reply] = await env.telegram("test", { noEnqueue: true });
  assert.equal(env.spoken.length, 1);
  assert.match(reply!, /cannot send/i);
});

test("Pi /voicenote test synthesizes a sample and reports the file path", async () => {
  const env = await setup();
  assert.match(await env.piCommand("test"), /\/tmp\/sample\.ogg/);
  assert.equal(env.spoken.length, 1);
});

test("Pi /voicenote menu without a UI prints the text menu", async () => {
  const env = await setup();
  const reply = await env.piCommand("menu");
  assert.match(reply, /^1\. Voice replies: on/m);
  assert.match(reply, /^5\. OpenAI API key: not set .*\/voicenote/m);
});

// --- 🎙 Voice notes section (inline buttons in pi-telegram's menu) ---

function sectionCtx(action = "", payload = "") {
  const edits: any[] = [];
  const opened: any[] = [];
  const answers: Array<string | undefined> = [];
  const prompts: string[] = [];
  return {
    edits, opened, answers, prompts,
    ctx: {
      sectionId: "pi-telegram-voicenote", chatId: 1, messageId: 2, action, payload,
      answerCallback: async (t?: string) => { answers.push(t); },
      edit: async (v: any) => { edits.push(v); },
      open: async (v: any) => { opened.push(v); },
      openRich: async () => {},
      enqueuePrompt: async (p: string) => { prompts.push(p); },
      callbackData: (a: string, p?: string) => `s:${a}:${p ?? ""}`,
      deleteMessage: async () => {},
    },
  };
}

const buttons = (view: any): Array<{ text: string; callback_data: string }> => view.replyMarkup.inline_keyboard.flat();

test("a Voice notes section with buttons is registered; every button shows its current value", async () => {
  const env = await setup({ enabled: false, voice: "es-AR-TomasNeural" });
  assert.equal(env.sections.length, 1);
  const section = env.sections[0];
  assert.equal(section.id, "pi-telegram-voicenote");
  assert.match(section.getLabel(), /Voice notes/);
  const view = await section.render(sectionCtx().ctx);
  assert.match(view.text, /Voice notes: off/);
  const labels = buttons(view).map((b) => b.text);
  assert.deepEqual(labels, [
    "Voice replies: off",
    "Voice: es-AR-TomasNeural",
    "Rate: +0%",
    "Voice input: auto → not configured",
    "OpenAI API key: not set",
    "OpenAI model: gpt-4o-mini-transcribe",
    "Audio language: auto",
    "Local engine (faster-whisper): not installed",
    "Test voice",
  ]);
  await env.shutdown();
  assert.equal(env.isSectionDisposed(), true);
});

test("section: a list marks the current value and a button press saves the new one", async () => {
  const env = await setup();
  const section = env.sections[0];
  const list = sectionCtx("voice");
  assert.equal(await section.handleCallback(list.ctx), "handled");
  const options = buttons(list.edits[0]);
  assert.ok(options.some((b) => b.text === "✓ es-MX-DaliaNeural"));
  const tomas = options.find((b) => b.text === "es-AR-TomasNeural")!;
  assert.equal(tomas.callback_data, "s:setvoice:es-AR-TomasNeural");
  const set = sectionCtx("setvoice", "es-AR-TomasNeural");
  assert.equal(await section.handleCallback(set.ctx), "handled");
  assert.equal(JSON.parse(env.file()).voice, "es-AR-TomasNeural");
  assert.ok(buttons(set.edits.at(-1)).some((b) => b.text === "Voice: es-AR-TomasNeural"));
  for (const [action, payload, key, value] of [
    ["setrate", "+20%", "rate", "+20%"], ["setstt", "off", "sttEngine", "off"],
    ["setmodel", "whisper-1", "sttOpenaiModel", "whisper-1"], ["setlang", "pt", "sttLanguage", "pt"],
  ] as const) {
    await section.handleCallback(sectionCtx(action, payload).ctx);
    assert.equal(JSON.parse(env.file())[key], value);
  }
  const toggle = sectionCtx("toggle");
  await section.handleCallback(toggle.ctx);
  assert.equal(JSON.parse(env.file()).enabled, false);
  assert.equal(buttons(toggle.edits.at(-1))[0]!.text, "Voice replies: off");
});

test("section: invalid payloads change nothing; the key button only explains; test queues a turn", async () => {
  const env = await setup();
  const section = env.sections[0];
  const before = env.file();
  await section.handleCallback(sectionCtx("setvoice", "bad voice").ctx);
  await section.handleCallback(sectionCtx("setrate", "fast").ctx);
  assert.equal(env.file(), before);
  const key = sectionCtx("key");
  assert.equal(await section.handleCallback(key.ctx), "handled");
  assert.match(key.edits[0].text, /Pi terminal/);
  assert.match(key.edits[0].text, /OPENAI_API_KEY/);
  assert.equal(existsSync(env.keyPath), false);
  const t = sectionCtx("test");
  await section.handleCallback(t.ctx);
  assert.equal(t.prompts.length, 1);
  assert.equal(await section.handleCallback(sectionCtx("unknown-action").ctx), "pass");
});

test("section: install asks first and runs setup only from the confirm button", async () => {
  const runs: string[] = [];
  const env = await setup({}, { stt: { env: {}, venvDir: "/venv", exists: () => false, runPython: async (bin) => { runs.push(bin); return "ok"; } } });
  const section = env.sections[0];
  const ask = sectionCtx("install");
  await section.handleCallback(ask.ctx);
  assert.equal(runs.length, 0);
  assert.match(ask.edits[0].text, /faster-whisper/);
  assert.ok(buttons(ask.edits[0]).some((b) => b.callback_data === "s:installgo:"));
  const go = sectionCtx("installgo");
  await section.handleCallback(go.ctx);
  assert.equal(runs.length, 3);
  assert.ok(go.opened.some((v) => /faster-whisper is ready/.test(v.text)));
});

test("without the sections API the Telegram text menu does not advertise buttons", async () => {
  const env = await setup({}, {}, { sections: false });
  assert.equal(env.sections.length, 0);
  const [menu] = await env.telegram("");
  assert.doesNotMatch(menu!, /buttons/i);
  assert.match(menu!, /^1\. Voice replies: on/m);
});
