# pi-telegram-voicenote

Narrated voice notes for [pi-telegram](https://github.com/llblab/pi-telegram).

When you talk to [Pi](https://pi.dev) from Telegram, every reply arrives twice:

1. the normal **text** reply, right away;
2. a **voice note** that explains it, written as a spoken script — tables, lists and code are told in words, not read symbol by symbol.

Your Pi terminal looks exactly the same as before. Turns you start in the terminal are not narrated; only Telegram turns are.

This is the Pi port of [hermes-telegram-voicenote](https://github.com/goldenSniperOS/hermes-telegram-voicenote).

## Requirements

- Pi with [`@llblab/pi-telegram`](https://github.com/llblab/pi-telegram) installed and connected (`/telegram-setup`, `/telegram-connect`).
- [`ffmpeg`](https://ffmpeg.org) on `PATH` (macOS: `brew install ffmpeg`).
- Internet access for Edge TTS (free, no account or API key).

## Install

```bash
pi install git:github.com/goldenSniperOS/pi-telegram-voicenote
```

Pin a version with `@v0.1.0` at the end. To try it for one run only: `pi -e git:github.com/goldenSniperOS/pi-telegram-voicenote`.

Install it wherever pi-telegram is installed. In Threaded Mode every Pi instance synthesizes its own replies, so every instance needs this extension loaded (a global `pi install` covers them all).

Then send any message to your bot. You get the text, and a few seconds later the voice note.

## Use

| Where | Command | Effect |
|---|---|---|
| Pi terminal | `/voicenote on` · `/voicenote off` · `/voicenote status` | Turn narration on or off (saved in the config file). |
| Telegram | `/voicenote on` · `off` · `status` | Same, when the Telegram command can be registered (see [Limitations](#limitations)). |

## Configuration

Optional file: `~/.pi/agent/telegram-voicenote.json` (or `$PI_CODING_AGENT_DIR/telegram-voicenote.json`). Every key is optional; invalid values fall back to defaults with a warning.

```json
{
  "enabled": true,
  "scriptMode": "llm",
  "model": "anthropic/claude-haiku-5-5",
  "maxScriptWords": 180,
  "language": "auto",
  "style": "Talk like a patient teacher.",
  "voice": "es-MX-DaliaNeural",
  "rate": "+10%"
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Narrate Telegram replies. |
| `scriptMode` | `"llm"` | `llm`: a model writes the spoken script. `plain`: clean the Markdown and read it, no model call. |
| `model` | current session model | `provider/id` of the model that writes the script, from the providers Pi already has configured. A small, fast model is a good choice. |
| `maxScriptWords` | `180` | Upper bound for the script (20–2000). 180 words is about one minute. |
| `scriptTimeoutMs` | `90000` | If the model takes longer, the plain script is used instead. |
| `language` | `"auto"` | `auto` speaks in the reply's language; or name one, e.g. `"Spanish"`. |
| `style` | `""` | Extra instructions for the script writer. |
| `voice` | `"es-MX-DaliaNeural"` | Edge TTS voice ([list](https://speech.microsoft.com/portal/voicegallery)), e.g. `en-US-AriaNeural`, `es-ES-AlvaroNeural`. |
| `rate` | `"+0%"` | Speaking rate, e.g. `"+15%"` or `"-10%"`. |
| `minResponseChars` | `1` | Skip replies shorter than this. |
| `ffmpegPath` | `"ffmpeg"` | Path to the ffmpeg binary. |

## Sending voice notes to Pi

Speech-to-text for your incoming voice notes is a pi-telegram feature, configured in `~/.pi/agent/telegram.json`. The simplest option is Groq Whisper (free tier, needs `GROQ_API_KEY`) through the [`groq-stt`](https://github.com/llblab/skills/tree/main/groq-stt) script:

```json
{
  "inboundHandlers": [
    { "mime": "audio/*", "template": ["/path/to/groq-stt/scripts/transcribe.sh", "{file}"] }
  ]
}
```

Check the script's `SKILL.md` for its exact arguments. See pi-telegram's [voice docs](https://github.com/llblab/pi-telegram/blob/main/docs/voice.md) for other engines.

## How it works

- pi-telegram prefixes Telegram prompts with `[telegram]`. On those turns, when the final reply is complete, this extension appends a hidden `<!-- telegram_voice … -->` marker that points to the reply.
- pi-telegram sends the text, sees the marker and asks registered voice providers for audio. This extension is one of them: it writes the script, synthesizes it with Edge TTS and converts it to OGG/Opus with ffmpeg, so Telegram shows a native voice bubble.
- Pi's terminal hides HTML comments, and the extension removes its marker from the conversation before every model call, so neither you nor the model see it.

This follows the composition the pi-telegram maintainer recommends for "text and voice" ([issue #235](https://github.com/llblab/pi-telegram/issues/235)): keep pi-telegram's voice reply mode on `manual` and let a companion add the `telegram_voice` action.

## Limitations

- **Keep pi-telegram's voice reply mode on `manual`** (its default). `mirror` and `always` work too, but they are designed to replace text with voice in other cases.
- **Do not configure voice `outboundHandlers` in `telegram.json`.** pi-telegram runs those before providers, so they would receive this extension's marker instead of your reply.
- The on/off switch is global, not per chat.
- The Telegram `/voicenote` command is registered only when `@llblab/pi-telegram` can be imported from this package; otherwise use `/voicenote` in the Pi terminal.
- `pi -p` (print mode) shows the marker as raw text.

## Develop

```bash
npm install
npm run check        # tsc + node:test
pi -e ./src/index.ts # load your working copy into Pi
```

Issues and pull requests are welcome.

## License

MIT
