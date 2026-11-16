# AGENTS.md

Instructions for coding agents working on `pi-telegram-voicenote`, a Pi extension companion to `@llblab/pi-telegram`.

## Release policy (mandatory)

**Every implemented feature or fix ends with a published version.** Work is not done until the release exists on GitHub and the clean-clone check passes.

Version bump (Semantic Versioning):

| Change | Bump |
| --- | --- |
| Bug fix, docs-only fix that ships in the package | patch (`0.2.0` → `0.2.1`) |
| New feature, new command, option or setting | minor (`0.2.x` → `0.3.0`) |
| Removed or changed behavior others rely on (settings, commands, provider contract) | major |

Steps, in order:

1. Work on a branch (`feat/<name>` or `fix/<name>`), never directly on `main`.
2. Tests first for behavior changes; `npm run check` must pass (tsc + `node --test`).
3. Bump `version` in `package.json` **and** both `version` fields at the top of `package-lock.json`.
4. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` (Keep a Changelog: Added / Changed / Fixed).
5. Update `README.md` when commands, settings or the install line change (`@vX.Y.Z` in the install example).
6. Push the branch: `git -C <repo> push -u origin <branch>`.
7. Open the PR against `main` (`gh pr create --base main --body-file <file>`), with summary, verification and known follow-ups.
8. Merge it with a merge commit: `gh pr merge <n> --merge`.
9. Create the release on the merge commit: `gh release create vX.Y.Z --target <merge-sha> --title "vX.Y.Z — <summary>" --notes-file <notes>`. Notes = the CHANGELOG section plus the install command.
10. Verify the published tag from a clean clone in a temp dir: `git clone --depth 1 --branch vX.Y.Z … && npm ci && npm run check`.
11. Sync local `main` (`git pull --ff-only origin main`) and report the release URL and the install command:

```bash
pi install git:github.com/goldenSniperOS/pi-telegram-voicenote@vX.Y.Z
```

## Gotchas

- The Gentle AI RDD pre-delivery guard must resolve the repository: use `git -C <repo>` for pushes and run `gh` as a single `cd <repo> && gh …` command (no heredocs in the same command). Write PR/release bodies to a file first.
- Pushing tags directly is blocked by the guard; create tags through `gh release create --target <sha>`.
- One test needs pi-telegram sources in `.refs/` and is skipped in a clean clone, so a clean clone reports one test fewer than the dev checkout.
- npm publication is not set up yet (needs the owner's npm account); GitHub releases are the distribution channel.

## Project map

- `src/index.ts`: extension wiring (voice marker, synthesis + transcription providers, `/voicenote`).
- `src/script.ts`: spoken script writer. `src/tts.ts`: Edge TTS → OGG/Opus via ffmpeg.
- `src/stt.ts`: voice input (OpenAI, local faster-whisper, `setup-stt`).
- `src/config.ts`: settings in `~/.pi/agent/telegram-voicenote.json`.
- `odd/tasks/pi-telegram-voicenote.md`: feature specs, tasks and evidence log.
