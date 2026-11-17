# pi-telegram-voicenote

Voice notes both ways for [pi-telegram](https://github.com/llblab/pi-telegram).

When you talk to [Pi](https://pi.dev) from Telegram, every reply arrives twice:

1. the normal **text** reply, right away;
2. a **voice note** that explains it, written as a spoken script — tables, lists and code are told in words, not read symbol by symbol.

It also works the other way: voice notes you send are transcribed (OpenAI or local faster-whisper) and reach Pi as text. See [Sending voice notes to Pi](#sending-voice-notes-to-pi).

Your Pi terminal looks exactly the same as before. Turns you start in the terminal are not narrated; only Telegram turns are.

This is the Pi port of [hermes-telegram-voicenote](https://github.com/goldenSniperOS/hermes-telegram-voicenote).

## Requirements

- Pi with [`@llblab/pi-telegram`](https://github.com/llblab/pi-telegram) installed and connected (`/telegram-setup`, `/telegram-connect`).
- [`ffmpeg`](https://ffmpeg.org) on `PATH` (macOS: `brew install ffmpeg`).
- Internet access for Edge TTS (free, no account or API key).
- For voice input, one of: an OpenAI API key (`OPENAI_API_KEY`, or pasted in the [wizard](#wizard)), or `python3` 3.9+ for local faster-whisper.

## Install

```bash
pi install git:github.com/goldenSniperOS/pi-telegram-voicenote
```

Pin a version with `@v0.2.0` at the end. To try it for one run only: `pi -e git:github.com/goldenSniperOS/pi-telegram-voicenote`.

Install it wherever pi-telegram is installed. In Threaded Mode every Pi instance synthesizes its own replies, so every instance needs this extension loaded (a global `pi install` covers them all).

Then send any message to your bot. You get the text, and a few seconds later the voice note.

## Wizard

Type `/voicenote` in the Pi terminal (or `/voicenote menu`). A menu opens with the current status at the top and one entry per setting, each showing its current value:

```text
Voice replies: on
Voice: es-AR-TomasNeural
Rate: +0%
Voice input: auto → faster-whisper (small)
OpenAI API key: set (saved)
OpenAI model: gpt-4o-mini-transcribe
Audio language: es
Local engine (faster-whisper): installed
Test voice
Done
```

Pick an entry to change it; the lists mark the current choice with `✓`, and **Other…** accepts any valid value. Every change is saved at once and applies to the next voice note. **Test voice** synthesizes a short sample with the current voice and rate and shows the file path. **Local engine** explains what it installs and asks before installing.

**OpenAI API key** is where you paste your key (or replace or delete it). The input field shows what you paste, so check who can see your screen. Without a UI (`pi -p`), `/voicenote` prints the status instead. All [commands](#commands) also work as shortcuts.

### Where the API key is stored

The key from the wizard goes to its own file, `~/.pi/agent/telegram-voicenote.secrets.json` (or `$PI_CODING_AGENT_DIR/telegram-voicenote.secrets.json`), readable only by you (mode `0600`), separate from the settings file. `OPENAI_API_KEY` in Pi's environment always wins over the saved key. The key is never printed: the status shows only `OpenAI key: set (env)`, `set (saved)` or `not set`.

### From Telegram

Everything except the API key works from Telegram too:

- **Buttons:** open the bot menu → **🎙 Voice notes**. Each button shows its current value; the lists mark the current choice with `✓`. **Test voice** queues a short reply so a real voice note arrives with the current voice. **Local engine** asks before installing. This uses pi-telegram's sections API and appears when this extension can import `@llblab/pi-telegram/sections`.
- **Text menu:** send `/voicenote`. The reply is the status plus a numbered list; each line shows the current value and the exact command to change it. Send a subcommand without a value (for example `/voicenote voice`) to see the choices with the current one marked.

The API key cannot be entered from Telegram, so it never stays in the chat history: `/voicenote key …` only explains where to enter it, stores nothing and never repeats what you sent. Paste it in the Pi terminal wizard or set `OPENAI_API_KEY`.

## Commands

Every setting is saved in the config file and applies at once. In Telegram they need the command to be registered (see [Limitations](#limitations)).

| Command | Pi terminal | Telegram | Effect |
|---|---|---|---|
| `/voicenote` | Opens the [wizard](#wizard) (status without a UI) | Status + numbered menu | Everything in one place. |
| `/voicenote menu` | Opens the wizard (text menu without a UI) | Status + numbered menu | Same as above. |
| `/voicenote status` | ✓ | ✓ | Show the status line. |
| `/voicenote on` · `/voicenote off` | ✓ | ✓ | Turn voice replies on or off. |
| `/voicenote voice <name>` | ✓ | ✓ | Edge TTS voice, e.g. `es-AR-TomasNeural`. Without a name: list the presets. |
| `/voicenote rate <±N%>` | ✓ | ✓ | Speaking rate, e.g. `+10%` (`10%` reads as `+10%`). Without a value: list the presets. |
| `/voicenote stt auto\|openai\|faster-whisper\|off` | ✓ | ✓ | Voice input engine (`local` = `faster-whisper`). Without a value: list them. |
| `/voicenote model <name>` | ✓ | ✓ | OpenAI transcription model: `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`, … |
| `/voicenote lang <code>` | ✓ | ✓ | Language of your voice notes: `auto`, `es`, `en`, `pt`, any ISO code (`language` also works). |
| `/voicenote test` | Synthesizes a sample and shows the file | Queues a short reply that arrives as a voice note | Hear the current voice. |
| `/voicenote setup-stt` · `setup-stt confirm` | ✓ | ✓ (progress in the chat) | Explain, then install local faster-whisper. |
| `/voicenote key` | Opens the key dialog (paste / replace / delete) | Refused: explains where to enter it | OpenAI API key. Typed as an argument it is never saved. |
| `/voicenote key delete` | Deletes the saved key | Refused | Remove the key saved by the wizard. |

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
| `sttEngine` | `"auto"` | Voice input engine: `auto`, `openai`, `faster-whisper` (or `local`), `off`. See [Sending voice notes to Pi](#sending-voice-notes-to-pi). |
| `sttOpenaiModel` | `"gpt-4o-mini-transcribe"` | OpenAI transcription model, e.g. `whisper-1`, `gpt-4o-transcribe`. |
| `sttLocalModel` | `"small"` | faster-whisper model: `tiny`, `base`, `small`, `medium`, `large-v3`, `turbo`, or a Hugging Face repo id. A new model downloads on first use. |
| `sttLanguage` | `"auto"` | Language code of your voice notes, e.g. `"es"`; `auto` detects it. |
| `sttTimeoutMs` | `120000` | Time limit per engine for one voice note (10000–1800000). |
| `sttPython` | plugin venv | A Python that already has `faster-whisper`, instead of the one `setup-stt` creates. |

## Sending voice notes to Pi

Voice notes you send on Telegram are transcribed by this extension and reach Pi as text. Choose the engine with `sttEngine`:

| Engine | Needs | Notes |
| --- | --- | --- |
| `auto` (default) | — | OpenAI when an API key is available; otherwise local faster-whisper when it is installed. If OpenAI fails, falls back to local. |
| `openai` | `OPENAI_API_KEY` in Pi's environment, or a key saved in the [wizard](#wizard) | Cloud. `OPENAI_BASE_URL` points it at a compatible API. |
| `faster-whisper` (alias `local`) | `/voicenote setup-stt` once | Runs on your machine; the audio never leaves it. |
| `off` | — | The extension does not transcribe; other pi-telegram handlers still can. |

Local setup is explicit (also from the wizard's **Local engine** entry or the Telegram buttons). `/voicenote setup-stt` explains what will be installed; `/voicenote setup-stt confirm` creates a Python environment in `~/.pi/agent/telegram-voicenote/stt-venv`, installs `faster-whisper` with pip and downloads the model (`small` by default, about 460 MB). It needs `python3` (3.9 or newer) and takes a few minutes the first time.

Switch engines in the wizard or with `/voicenote stt auto|openai|faster-whisper|off`; `/voicenote status` shows which one is in use. When no engine is available, Pi receives a short note saying how to configure one instead of an unreadable audio file.

pi-telegram runs audio `inboundHandlers` from `~/.pi/agent/telegram.json` before this extension. If you configured one earlier (for example Groq Whisper through [`groq-stt`](https://github.com/llblab/skills/tree/main/groq-stt)), it keeps winning; remove it to use the engines above.

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
- The **🎙 Voice notes** buttons need pi-telegram's sections API (`@llblab/pi-telegram/sections`, pi-telegram 0.10.0 or newer) under the same condition; the `/voicenote` text menu works without it.
- A Telegram command cannot send audio itself, so `/voicenote test` from Telegram queues a short prompt and the agent's reply brings the voice note (one model turn).
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
