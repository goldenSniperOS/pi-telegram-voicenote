import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretsPath } from "../src/config.ts";
import { deleteSavedApiKey, describeApiKey, readSavedApiKey, resolveApiKey, saveApiKey, validateApiKey } from "../src/secrets.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "voicenote-secrets-")), "nested", "telegram-voicenote.secrets.json");
const mode = (path: string) => statSync(path).mode & 0o777;

test("secretsPath lives next to the config and honors PI_CODING_AGENT_DIR", () => {
  assert.equal(secretsPath({ PI_CODING_AGENT_DIR: "/x/agent" }, "/home/u"), join("/x/agent", "telegram-voicenote.secrets.json"));
  assert.equal(secretsPath({ PI_CODING_AGENT_DIR: "~/alt" }, "/home/u"), join("/home/u", "alt", "telegram-voicenote.secrets.json"));
  assert.equal(secretsPath({}, "/home/u"), join("/home/u", ".pi", "agent", "telegram-voicenote.secrets.json"));
});

test("saveApiKey writes only the key as JSON with mode 0600", () => {
  const path = file();
  saveApiKey("sk-test-123", path);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { openaiApiKey: "sk-test-123" });
  assert.equal(mode(path), 0o600);
  assert.equal(readSavedApiKey(path), "sk-test-123");
});

test("saveApiKey tightens an existing file to 0600 and keeps other keys", () => {
  const path = file();
  saveApiKey("sk-old", path);
  writeFileSync(path, JSON.stringify({ openaiApiKey: "sk-old", other: 1 }));
  chmodSync(path, 0o644);
  saveApiKey("sk-new", path);
  assert.equal(mode(path), 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { openaiApiKey: "sk-new", other: 1 });
});

test("validateApiKey trims and rejects empty keys or keys with whitespace inside", () => {
  assert.deepEqual(validateApiKey("  sk-abc_123  "), { key: "sk-abc_123" });
  for (const bad of ["", "   ", "sk abc", "sk-a\tb", "sk-a\nb"]) {
    const result = validateApiKey(bad);
    assert.ok("error" in result, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.ok(!("key" in result));
  }
});

test("the environment key wins over the saved key; an empty env falls back to the file", () => {
  const path = file();
  assert.equal(resolveApiKey({}, path), undefined);
  assert.equal(describeApiKey({}, path), "not set");
  saveApiKey("sk-saved", path);
  assert.deepEqual(resolveApiKey({}, path), { key: "sk-saved", source: "saved" });
  assert.deepEqual(resolveApiKey({ OPENAI_API_KEY: "  " }, path), { key: "sk-saved", source: "saved" });
  assert.equal(describeApiKey({}, path), "set (saved)");
  assert.deepEqual(resolveApiKey({ OPENAI_API_KEY: " sk-env " }, path), { key: "sk-env", source: "env" });
  assert.equal(describeApiKey({ OPENAI_API_KEY: "sk-env" }, path), "set (env)");
  assert.deepEqual(resolveApiKey({ OPENAI_API_KEY: "sk-env" }, undefined), { key: "sk-env", source: "env" });
});

test("a broken or foreign secrets file counts as no saved key and never throws", () => {
  const path = file();
  saveApiKey("x", path);
  writeFileSync(path, "{nope");
  assert.equal(readSavedApiKey(path), undefined);
  writeFileSync(path, JSON.stringify({ openaiApiKey: "has space" }));
  assert.equal(readSavedApiKey(path), undefined);
  assert.equal(readSavedApiKey(join(tmpdir(), "voicenote-missing", "none.json")), undefined);
});

test("deleteSavedApiKey removes the key and reports whether one was saved", () => {
  const path = file();
  assert.equal(deleteSavedApiKey(path), false);
  saveApiKey("sk-gone", path);
  assert.equal(deleteSavedApiKey(path), true);
  assert.equal(readSavedApiKey(path), undefined);
  assert.ok(existsSync(path));
  assert.doesNotMatch(readFileSync(path, "utf8"), /sk-gone/);
  assert.equal(mode(path), 0o600);
});
