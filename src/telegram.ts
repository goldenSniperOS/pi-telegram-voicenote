/**
 * "🎙 Voice notes" in pi-telegram's inline menu: the same settings as the Pi
 * wizard, as buttons, through pi-telegram's stable sections API
 * (`registerTelegramSection` from `@llblab/pi-telegram/sections`). Every button
 * shows its current value. The API key cannot be entered here.
 *
 * Types mirror pi-telegram's public contract so there is no hard dependency.
 */

import { parseOpenaiModel, parseRate, parseSttEngine, parseSttLanguage, parseVoice, type VoicenoteConfig } from "./config.ts";
import { KEY_WHERE, testPrompt } from "./commands.ts";
import {
  choiceList,
  ENGINE_PRESETS,
  LANGUAGE_PRESETS,
  OPENAI_MODEL_PRESETS,
  RATE_PRESETS,
  VOICE_PRESETS,
  type Preset,
} from "./options.ts";
import { menuEntries, type VoicenoteController } from "./wizard.ts";

interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramSectionView {
  text: string;
  parseMode?: "markdown" | "html" | "plain";
  replyMarkup?: { inline_keyboard: InlineButton[][] };
}

interface SectionContext {
  answerCallback(text?: string): Promise<void>;
  edit(view: TelegramSectionView): Promise<void>;
  open(view: TelegramSectionView): Promise<void>;
  enqueuePrompt?(prompt: string): Promise<void>;
  callbackData(action: string, payload?: string): string;
}

interface SectionCallbackContext extends SectionContext {
  action: string;
  payload: string;
}

export interface TelegramSectionRegistration {
  id: string;
  label: string;
  order?: number;
  getLabel?: () => string;
  render: (ctx: SectionContext) => TelegramSectionView | Promise<TelegramSectionView>;
  handleCallback?: (ctx: SectionCallbackContext) => "handled" | "pass" | Promise<"handled" | "pass">;
}

export interface TelegramSectionsModule {
  registerTelegramSection?: (registration: TelegramSectionRegistration) => () => void;
}

export const SECTION_ID = "pi-telegram-voicenote";

interface ListSetting {
  title: string;
  set: string;
  key: keyof VoicenoteConfig;
  presets: readonly Preset[];
  parse: (value: string) => string | undefined;
  other?: string;
}

const LISTS: Record<string, ListSetting> = {
  voice: { title: "Voice", set: "setvoice", key: "voice", presets: VOICE_PRESETS, parse: parseVoice, other: "/voicenote voice <name>" },
  rate: { title: "Rate", set: "setrate", key: "rate", presets: RATE_PRESETS, parse: parseRate },
  engine: { title: "Voice input", set: "setstt", key: "sttEngine", presets: ENGINE_PRESETS, parse: (v) => parseSttEngine(v) },
  model: { title: "OpenAI model", set: "setmodel", key: "sttOpenaiModel", presets: OPENAI_MODEL_PRESETS, parse: parseOpenaiModel, other: "/voicenote model <name>" },
  lang: { title: "Audio language", set: "setlang", key: "sttLanguage", presets: LANGUAGE_PRESETS, parse: parseSttLanguage, other: "/voicenote lang <code>" },
};
const SETTERS = new Map(Object.values(LISTS).map((list) => [list.set, list]));

/** A button, or undefined when the value cannot travel in Telegram's 64-byte callback data. */
function button(ctx: SectionContext, text: string, action: string, payload?: string): InlineButton | undefined {
  if (payload?.includes(":")) return undefined;
  try {
    return { text, callback_data: ctx.callbackData(action, payload) };
  } catch {
    return undefined;
  }
}

const rows = (buttons: Array<InlineButton | undefined>) => ({
  inline_keyboard: buttons.filter((b): b is InlineButton => b !== undefined).map((b) => [b]),
});

export function createVoicenoteSection(c: VoicenoteController): TelegramSectionRegistration {
  let installing = false;

  const mainView = (ctx: SectionContext): TelegramSectionView => {
    const e = menuEntries(c);
    return {
      text: `🎙 Voice notes\n${c.status()}`,
      parseMode: "plain",
      replyMarkup: rows([
        button(ctx, e.toggle, "toggle"),
        button(ctx, e.voice, "voice"),
        button(ctx, e.rate, "rate"),
        button(ctx, e.engine, "engine"),
        button(ctx, e.key, "key"),
        button(ctx, e.model, "model"),
        button(ctx, e.language, "lang"),
        button(ctx, e.install, "install"),
        button(ctx, e.test, "test"),
      ]),
    };
  };

  const listView = (ctx: SectionContext, list: ListSetting): TelegramSectionView => {
    const current = String(c.config()[list.key]);
    const choices = choiceList(list.presets, current, false);
    return {
      text: [`${list.title} — current: ${current}`, list.other ? `Other: send ${list.other}` : ""].filter(Boolean).join("\n"),
      parseMode: "plain",
      replyMarkup: rows(choices.map((choice) => button(ctx, choice.label, list.set, choice.value))),
    };
  };

  const handleCallback = async (ctx: SectionCallbackContext): Promise<"handled" | "pass"> => {
    const { action, payload } = ctx;
    const list = LISTS[action];
    if (list) {
      await ctx.edit(listView(ctx, list));
      return "handled";
    }
    const setter = SETTERS.get(action);
    if (setter) {
      const parsed = setter.parse(payload);
      if (!parsed) {
        await ctx.answerCallback("Not a valid value; nothing changed.");
        return "handled";
      }
      c.update({ [setter.key]: parsed } as Partial<VoicenoteConfig>);
      await ctx.answerCallback(`${setter.title}: ${parsed}`);
      await ctx.edit(mainView(ctx));
      return "handled";
    }
    switch (action) {
      case "toggle": {
        const enabled = !c.config().enabled;
        c.update({ enabled });
        await ctx.answerCallback(`Voice replies: ${enabled ? "on" : "off"}`);
        await ctx.edit(mainView(ctx));
        return "handled";
      }
      case "key":
        await ctx.edit({
          text: `OpenAI API key: ${c.keyState()}\n\nFor safety the key cannot be entered from Telegram, so it never stays in the chat history. ${KEY_WHERE}`,
          parseMode: "plain",
        });
        return "handled";
      case "install":
        await ctx.edit({
          text: `${c.setupExplanation()}\n\nIt takes a few minutes the first time.`,
          parseMode: "plain",
          replyMarkup: rows([button(ctx, "Install now", "installgo")]),
        });
        return "handled";
      case "installgo": {
        if (installing) {
          await ctx.answerCallback("Already installing…");
          return "handled";
        }
        installing = true;
        try {
          await ctx.answerCallback("Installing local speech-to-text…");
          const say = (text: string) => ctx.open({ text, parseMode: "plain" });
          await say(await c.setupStt(say));
        } finally {
          installing = false;
        }
        return "handled";
      }
      case "test": {
        const config = c.config();
        if (!config.enabled) {
          await ctx.answerCallback("Voice replies are off; turn them on first.");
        } else if (ctx.enqueuePrompt) {
          await ctx.enqueuePrompt(testPrompt(config.voice));
          await ctx.answerCallback(`Voice test queued (${config.voice}).`);
        } else {
          await ctx.answerCallback("Send /voicenote test to try the voice.");
        }
        return "handled";
      }
      case "main":
        await ctx.edit(mainView(ctx));
        return "handled";
      default:
        return "pass";
    }
  };

  return {
    id: SECTION_ID,
    label: "🎙 Voice notes",
    getLabel: () => `🎙 Voice notes: ${c.config().enabled ? "on" : "off"}`,
    render: mainView,
    handleCallback,
  };
}
