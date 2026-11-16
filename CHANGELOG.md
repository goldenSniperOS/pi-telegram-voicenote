# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
