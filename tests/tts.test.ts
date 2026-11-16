import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escapeXml, splitText, synthesize, type SpeechEngine } from "../src/tts.ts";

const settings = { voice: "es-MX-DaliaNeural", rate: "+0%", ffmpegPath: "ffmpeg" };

test("escapeXml escapes the five XML specials", () => {
  assert.equal(escapeXml(`a<b>&"c'`), "a&lt;b&gt;&amp;&quot;c&apos;");
});

test("splitText keeps short text whole and splits long text at sentence boundaries", () => {
  assert.deepEqual(splitText("Hello there.", 100), ["Hello there."]);
  const parts = splitText("One two three. Four five six. Seven eight nine.", 20);
  assert.deepEqual(parts, ["One two three.", "Four five six.", "Seven eight nine."]);
  const words = splitText("aaaa bbbb cccc dddd", 9);
  assert.deepEqual(words, ["aaaa bbbb", "cccc dddd"]);
  for (const p of splitText("x".repeat(25), 10)) assert.ok(p.length <= 10);
});

test("synthesize escapes text, joins chunks and converts to OGG/Opus via ffmpeg argv", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voicenote-tts-"));
  const calls: Array<{ text: string; voice: string; rate: string }> = [];
  const engine: SpeechEngine = async (text, opts) => {
    calls.push({ text, ...opts });
    return Buffer.from(`[${text}]`);
  };
  let argv: string[] = [];
  let inputBytes = "";
  const out = await synthesize("Tom & Jerry <3.", settings, {
    engine,
    dir,
    runFfmpeg: async (bin, args) => {
      assert.equal(bin, "ffmpeg");
      argv = args;
      inputBytes = readFileSync(args[args.indexOf("-i") + 1]!, "utf8");
      writeFileSync(args[args.length - 1]!, "ogg");
    },
  });
  assert.deepEqual(calls, [{ text: "Tom &amp; Jerry &lt;3.", voice: "es-MX-DaliaNeural", rate: "+0%" }]);
  assert.equal(inputBytes, "[Tom &amp; Jerry &lt;3.]");
  assert.ok(out.endsWith(".ogg") && out.startsWith(dir));
  assert.equal(readFileSync(out, "utf8"), "ogg");
  for (const flag of ["-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1"]) assert.ok(argv.includes(flag), flag);
  assert.equal(existsSync(argv[argv.indexOf("-i") + 1]!), false, "intermediate audio removed");
});

test("synthesize rejects empty text and engine failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voicenote-tts-"));
  const runFfmpeg = async () => {};
  await assert.rejects(synthesize("   ", settings, { engine: async () => Buffer.from("x"), dir, runFfmpeg }), /empty/);
  await assert.rejects(synthesize("hi", settings, { engine: async () => { throw new Error("net down"); }, dir, runFfmpeg }), /net down/);
});
