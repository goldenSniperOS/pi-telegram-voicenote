/**
 * The deterministic voice marker appended to Telegram replies.
 * pi-telegram's `telegram_voice` parser hands the JSON `text` to our synthesis
 * provider, which maps the sentinel back to the cached reply.
 */

export const SENTINEL_PREFIX = "@pi-telegram-voicenote:";

const SENTINEL_PATTERN = /^@pi-telegram-voicenote:([A-Za-z0-9_-]+)$/;
const MARKER_PATTERN = /\s*<!-- telegram_voice \{"text":"@pi-telegram-voicenote:[A-Za-z0-9_-]+"\} -->/g;
const VOICE_MARKUP_PATTERN = /<!--\s*!?telegram_voice\b/;

export function markerSentinel(id: string): string {
  return `${SENTINEL_PREFIX}${id}`;
}

export function buildMarker(id: string): string {
  return `<!-- telegram_voice ${JSON.stringify({ text: markerSentinel(id) })} -->`;
}

/** Returns our cache id for provider text, or undefined for anyone else's text. */
export function parseMarkerId(text: string): string | undefined {
  return SENTINEL_PATTERN.exec(text.trim())?.[1];
}

export function hasVoiceMarkup(text: string): boolean {
  return VOICE_MARKUP_PATTERN.test(text);
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

/**
 * Removes our markers from assistant messages. Returns a new list only when
 * something was stripped, so an unchanged context keeps Pi's cache prefix.
 */
export function stripMarkers<T>(messages: readonly T[]): T[] | undefined {
  let changed = false;
  const out = messages.map((message) => {
    const m = message as MessageLike;
    if (m.role !== "assistant" || !Array.isArray(m.content)) return message;
    let touched = false;
    const content = m.content.flatMap((part: { type?: unknown; text?: unknown }) => {
      if (part?.type !== "text" || typeof part.text !== "string") return [part];
      const text = part.text.replace(MARKER_PATTERN, "");
      if (text === part.text) return [part];
      touched = true;
      return text.trim() ? [{ ...part, text }] : [];
    });
    if (!touched) return message;
    changed = true;
    return { ...m, content } as T;
  });
  return changed ? out : undefined;
}
