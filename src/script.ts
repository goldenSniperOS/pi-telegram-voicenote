/**
 * Turn a formatted chat reply into a script meant to be heard.
 * Port of hermes-telegram-voicenote script.py.
 */

export type ScriptMode = "llm" | "plain";

export interface ScriptSettings {
  scriptMode: ScriptMode;
  maxScriptWords: number;
  scriptTimeoutMs: number;
  language: string;
  style: string;
}

/** Writes the spoken script. Must honor `signal` when it can. */
export type ScriptWriter = (systemPrompt: string, reply: string, signal: AbortSignal) => Promise<string>;

const SYSTEM_PROMPT = `You write the spoken version of a chat reply. The user will listen to it as a voice note, often on the move, instead of reading a long answer on a phone screen.

Rules:
- {language_rule}
- Use a warm, natural, conversational tone.
- This is a script to be heard, not read. Never read Markdown, symbols, code, URLs, file paths, or table syntax aloud.
- Explain tables, lists, and code in plain words: say what they show and why it matters, instead of reciting cells or lines.
- Keep the substance and the conclusion. Drop decoration, repetition, and formatting.
- Do not mention that this is audio, a voice note, a script, or a summary.
- Maximum {max_words} words.
- Output only the script text, with no preamble.`;

export function buildSystemPrompt(settings: Pick<ScriptSettings, "language" | "maxScriptWords" | "style">): string {
  const language = settings.language.trim();
  const rule = !language || language.toLowerCase() === "auto"
    ? "Write in the same language as the reply."
    : `Write in ${language}.`;
  let prompt = SYSTEM_PROMPT.replace("{language_rule}", rule).replace("{max_words}", String(settings.maxScriptWords));
  if (settings.style.trim()) prompt += `\n\nAdditional style instructions from the user:\n${settings.style.trim()}`;
  return prompt;
}

/** Deterministic cleanup, used for plain mode and when the writer fails. */
export function plainScript(markdown: string, maxWords: number): string {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>|[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").filter(Boolean).slice(0, maxWords).join(" ");
}

export async function makeScript(
  markdown: string,
  settings: ScriptSettings,
  writer: ScriptWriter | undefined,
  onFallback?: (reason: string) => void,
): Promise<string> {
  if (settings.scriptMode === "llm" && writer) {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`script writer timed out after ${settings.scriptTimeoutMs} ms`));
      }, settings.scriptTimeoutMs);
    });
    try {
      const script = (await Promise.race([writer(buildSystemPrompt(settings), markdown, controller.signal), timeout]))?.trim();
      if (script) return script;
      onFallback?.("script writer returned empty text");
    } catch (error) {
      onFallback?.(`script writer failed (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      clearTimeout(timer);
    }
  }
  return plainScript(markdown, settings.maxScriptWords);
}
