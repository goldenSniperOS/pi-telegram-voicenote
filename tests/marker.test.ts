import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildMarker, hasVoiceMarkup, markerSentinel, parseMarkerId, stripMarkers } from "../src/marker.ts";

test("marker is a telegram_voice comment whose JSON names our sentinel", () => {
  const marker = buildMarker("abc-1");
  assert.equal(marker, '<!-- telegram_voice {"text":"@pi-telegram-voicenote:abc-1"} -->');
  const json = marker.slice(marker.indexOf("{"), marker.lastIndexOf("}") + 1);
  assert.deepEqual(JSON.parse(json), { text: "@pi-telegram-voicenote:abc-1" });
  assert.equal(markerSentinel("abc-1"), "@pi-telegram-voicenote:abc-1");
});

test("parseMarkerId accepts only our sentinel", () => {
  assert.equal(parseMarkerId("@pi-telegram-voicenote:abc-1"), "abc-1");
  assert.equal(parseMarkerId("  @pi-telegram-voicenote:abc-1\n"), "abc-1");
  assert.equal(parseMarkerId("Hello there"), undefined);
  assert.equal(parseMarkerId("@pi-telegram-voicenote:"), undefined);
  assert.equal(parseMarkerId("say @pi-telegram-voicenote:abc-1 now"), undefined);
});

test("hasVoiceMarkup detects existing telegram_voice comments", () => {
  assert.equal(hasVoiceMarkup('hi <!-- telegram_voice {"text":"x"} -->'), true);
  assert.equal(hasVoiceMarkup("hi <!--  !telegram_voice text=x -->"), true);
  assert.equal(hasVoiceMarkup("hi <!-- other -->"), false);
});

test("stripMarkers removes only our marker from assistant messages", () => {
  const user = { role: "user", content: "tell me", timestamp: 1 };
  const assistant = {
    role: "assistant",
    content: [
      { type: "text", text: "Answer" },
      { type: "text", text: `\n\n${buildMarker("abc-1")}` },
    ],
  };
  const foreign = { role: "assistant", content: [{ type: "text", text: 'x <!-- telegram_voice {"text":"keep"} -->' }] };
  const out = stripMarkers([user, assistant, foreign]);
  assert.ok(out);
  assert.equal(out[0], user);
  assert.deepEqual(out[1], { role: "assistant", content: [{ type: "text", text: "Answer" }] });
  assert.equal(out[2], foreign);
  assert.equal(stripMarkers([user, foreign]), undefined);
});

const refParser = new URL("../.refs/pi-telegram/lib/outbound-markup.ts", import.meta.url);
test("pi-telegram's voice planner extracts our sentinel", { skip: !existsSync(refParser) && "pi-telegram reference checkout not present" }, async () => {
  const { planTelegramVoiceReply } = await import(refParser.href);
  const plan = planTelegramVoiceReply(`Hello **world**\n\n${buildMarker("abc-1")}`);
  assert.equal(plan.markdown, "Hello **world**");
  assert.equal(plan.voiceText, "@pi-telegram-voicenote:abc-1");
});
