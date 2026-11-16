import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, makeScript, plainScript, type ScriptSettings } from "../src/script.ts";

const settings: ScriptSettings = {
  scriptMode: "llm",
  maxScriptWords: 180,
  scriptTimeoutMs: 5000,
  language: "auto",
  style: "",
};

const reply = "## Results\n\n| Name | Score |\n|---|---|\n| Ana | 9 |\n\n```js\nconsole.log(1)\n```\n\nSee [docs](x) and `npm test`.";

test("system prompt carries the narration rules and word cap", () => {
  const prompt = buildSystemPrompt({ ...settings, maxScriptWords: 120 });
  assert.match(prompt, /same language as the reply/);
  assert.match(prompt, /warm, natural, conversational/);
  assert.match(prompt, /Never read Markdown, symbols, code, URLs, file paths, or table syntax/);
  assert.match(prompt, /Explain tables, lists, and code in plain words/);
  assert.match(prompt, /Do not mention that this is audio/);
  assert.match(prompt, /Maximum 120 words/);
  assert.match(prompt, /Output only the script text/);
  assert.doesNotMatch(prompt, /Additional style/);
});

test("system prompt honors a fixed language and appends style", () => {
  const prompt = buildSystemPrompt({ ...settings, language: "Spanish", style: "Sound like a friend." });
  assert.match(prompt, /Write in Spanish\./);
  assert.match(prompt, /Additional style instructions from the user:\nSound like a friend\./);
});

test("plainScript strips markdown, code fences and caps words", () => {
  const out = plainScript(reply, 180);
  assert.doesNotMatch(out, /[`*_#>|[\]]/);
  assert.doesNotMatch(out, /console\.log/);
  assert.match(out, /^Results Name Score/);
  assert.equal(plainScript("one two three four", 2), "one two");
});

test("makeScript uses the writer output when it succeeds", async () => {
  let seen: { system: string; user: string } | undefined;
  const out = await makeScript(reply, settings, async (system, user) => {
    seen = { system, user };
    return "  Here is what happened.  ";
  });
  assert.equal(out, "Here is what happened.");
  assert.equal(seen?.user, reply);
  assert.match(seen?.system ?? "", /Maximum 180 words/);
});

test("makeScript falls back to plain on writer error, empty output, or no writer", async () => {
  const plain = plainScript(reply, 180);
  assert.equal(await makeScript(reply, settings, async () => { throw new Error("boom"); }), plain);
  assert.equal(await makeScript(reply, settings, async () => "   "), plain);
  assert.equal(await makeScript(reply, settings, undefined), plain);
});

test("makeScript skips the writer in plain mode", async () => {
  let called = false;
  const out = await makeScript(reply, { ...settings, scriptMode: "plain" }, async () => {
    called = true;
    return "x";
  });
  assert.equal(called, false);
  assert.equal(out, plainScript(reply, 180));
});

test("makeScript times out a slow writer, aborts it, and falls back", async () => {
  let aborted = false;
  const out = await makeScript(reply, { ...settings, scriptTimeoutMs: 20 }, (_s, _u, signal) =>
    new Promise<string>((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; });
      setTimeout(() => resolve("late"), 500).unref();
    }),
  );
  assert.equal(out, plainScript(reply, 180));
  assert.equal(aborted, true);
});
