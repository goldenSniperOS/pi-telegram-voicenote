import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, configPath, loadConfig, saveConfig, sttVenvDir } from "../src/config.ts";

const dir = () => mkdtempSync(join(tmpdir(), "voicenote-config-"));

test("missing file yields defaults without a warning", () => {
  const { config, warning } = loadConfig(join(dir(), "none.json"));
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(warning, undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.scriptMode, "llm");
  assert.equal(config.model, undefined);
  assert.equal(config.maxScriptWords, 180);
  assert.equal(config.voice, "es-MX-DaliaNeural");
});

test("values are validated and clamped", () => {
  const path = join(dir(), "c.json");
  writeFileSync(path, JSON.stringify({
    enabled: false, scriptMode: "weird", model: "openai/gpt-x", maxScriptWords: 3,
    scriptTimeoutMs: 10, language: " Spanish ", style: " brief ", voice: "bad\"voice",
    rate: "fast", minResponseChars: 0, ffmpegPath: "/opt/ffmpeg",
  }));
  const { config, warning } = loadConfig(path);
  assert.equal(warning, undefined);
  assert.equal(config.enabled, false);
  assert.equal(config.scriptMode, "llm");
  assert.equal(config.model, "openai/gpt-x");
  assert.equal(config.maxScriptWords, 20);
  assert.equal(config.scriptTimeoutMs, 5000);
  assert.equal(config.language, "Spanish");
  assert.equal(config.style, "brief");
  assert.equal(config.voice, DEFAULT_CONFIG.voice);
  assert.equal(config.rate, DEFAULT_CONFIG.rate);
  assert.equal(config.minResponseChars, 1);
  assert.equal(config.ffmpegPath, "/opt/ffmpeg");
  writeFileSync(path, JSON.stringify({ rate: "-10%", voice: "en-US-AvaNeural", model: "nomodel" }));
  const second = loadConfig(path).config;
  assert.equal(second.rate, "-10%");
  assert.equal(second.voice, "en-US-AvaNeural");
  assert.equal(second.model, undefined);
});

test("invalid JSON yields defaults plus a warning and never throws", () => {
  const path = join(dir(), "bad.json");
  writeFileSync(path, "{nope");
  const { config, warning } = loadConfig(path);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.match(warning ?? "", /bad\.json/);
  writeFileSync(path, "[1,2]");
  assert.match(loadConfig(path).warning ?? "", /object/);
});

test("saveConfig merges into the existing file and creates folders", () => {
  const path = join(dir(), "nested", "c.json");
  saveConfig({ enabled: false }, path);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { enabled: false });
  writeFileSync(path, JSON.stringify({ voice: "en-US-AvaNeural", custom: 1 }));
  saveConfig({ enabled: true }, path);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { voice: "en-US-AvaNeural", custom: 1, enabled: true });
});

test("configPath honors PI_CODING_AGENT_DIR", () => {
  assert.equal(configPath({ PI_CODING_AGENT_DIR: "/x/agent" }, "/home/u"), join("/x/agent", "telegram-voicenote.json"));
  assert.equal(configPath({ PI_CODING_AGENT_DIR: "~/alt" }, "/home/u"), join("/home/u", "alt", "telegram-voicenote.json"));
  assert.equal(configPath({}, "/home/u"), join("/home/u", ".pi", "agent", "telegram-voicenote.json"));
});

test("speech-to-text settings default to auto, small and OpenAI's mini model", () => {
  const { config } = loadConfig(join(dir(), "none.json"));
  assert.equal(config.sttEngine, "auto");
  assert.equal(config.sttLocalModel, "small");
  assert.equal(config.sttOpenaiModel, "gpt-4o-mini-transcribe");
  assert.equal(config.sttLanguage, "auto");
  assert.equal(config.sttTimeoutMs, 120_000);
  assert.equal(config.sttPython, undefined);
});

test("speech-to-text settings are validated", () => {
  const path = join(dir(), "c.json");
  writeFileSync(path, JSON.stringify({ sttEngine: "local", sttLocalModel: "large-v3", sttOpenaiModel: "whisper-1", sttLanguage: " es ", sttTimeoutMs: 1, sttPython: " /opt/py " }));
  const { config } = loadConfig(path);
  assert.equal(config.sttEngine, "faster-whisper");
  assert.equal(config.sttLocalModel, "large-v3");
  assert.equal(config.sttOpenaiModel, "whisper-1");
  assert.equal(config.sttLanguage, "es");
  assert.equal(config.sttTimeoutMs, 10_000);
  assert.equal(config.sttPython, "/opt/py");
  writeFileSync(path, JSON.stringify({ sttEngine: "whisperx", sttLocalModel: "bad model;rm" }));
  const bad = loadConfig(path).config;
  assert.equal(bad.sttEngine, "auto");
  assert.equal(bad.sttLocalModel, "small");
});

test("the local speech-to-text venv lives next to the settings file", () => {
  assert.equal(sttVenvDir({ PI_CODING_AGENT_DIR: "/agent" }, "/home/u"), join("/agent", "telegram-voicenote", "stt-venv"));
  assert.equal(sttVenvDir({}, "/home/u"), join("/home/u", ".pi", "agent", "telegram-voicenote", "stt-venv"));
});
