# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
