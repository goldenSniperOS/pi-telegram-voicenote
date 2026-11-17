# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-11-16

### Added
- Wizard: `/voicenote` (or `/voicenote menu`) in Pi opens an interactive menu. Every entry shows
  its current value and every list marks the selected option: voice replies on/off, voice,
  rate, voice input engine, OpenAI API key, OpenAI model, audio language, local engine install
  and a test voice.
- OpenAI API key from the wizard, saved in `~/.pi/agent/telegram-voicenote.secrets.json`
  (mode 0600, separate from the settings). `OPENAI_API_KEY` in the environment still wins.
  Status shows only `set (env)`, `set (saved)` or `not set`.
- Telegram: a "🎙 Voice notes" section with buttons in the bot menu (pi-telegram
  `registerTelegramSection`), with the same options except entering the key.
- New subcommands for Pi and Telegram: `voice`, `rate`, `model`, `lang`, `test`, `key`, `menu`.
  Without a value they list the choices with the current one marked.
- `/voicenote test` from Telegram queues a short turn, so the answer arrives as a real voice note.

### Security
- Telegram never accepts an API key: `/voicenote key …` and the key button store nothing and
  never repeat the input; the key is entered only from the Pi terminal.

### Changed
- The status line also shows the rate and the OpenAI key state.
- Voice and model names are limited to 64 characters.

## [0.2.0] - 2026-11-16

### Added
- Voice input: incoming Telegram voice notes are transcribed and reach Pi as text, through
  pi-telegram's transcription provider registry. Engines: OpenAI (`OPENAI_API_KEY`,
  `gpt-4o-mini-transcribe` by default) and local faster-whisper (`small` by default).
  `sttEngine: "auto"` prefers OpenAI when a key exists, falls back to local, and otherwise
  tells the agent how to configure an engine.
- `/voicenote setup-stt [confirm]`: guided, explicit install of faster-whisper in a
  plugin-owned Python environment, with the model prefetched.
- `/voicenote stt auto|openai|faster-whisper|off`, and the engine in use in `/voicenote status`.
- Settings `sttEngine`, `sttOpenaiModel`, `sttLocalModel`, `sttLanguage`, `sttTimeoutMs`, `sttPython`.

### Changed
- Unknown `/voicenote` arguments now print the full usage, including the new subcommands.

## [0.1.0] - 2026-11-16

### Added
- Pi extension, companion to `@llblab/pi-telegram`: replies to Telegram turns keep their
  normal text and also arrive as a narrated voice note. Terminal turns are untouched.
- Spoken script written by a model from Pi's configured providers (the current model or
  `model: "provider/id"`), with a plain-text fallback on error, empty output or timeout.
- Edge TTS synthesis (free, no API key) converted to OGG/Opus with ffmpeg; long scripts
  are split into chunks. The speech engine sits behind a small interface.
- `/voicenote on|off|status` in Pi, plus a Telegram `/voicenote` command when
  pi-telegram's command API is resolvable.
- Settings file `~/.pi/agent/telegram-voicenote.json` (honors `PI_CODING_AGENT_DIR`).
