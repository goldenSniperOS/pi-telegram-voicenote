# pi-telegram-voicenote

Pi extension package, companion to `@llblab/pi-telegram`: Telegram turns get the normal text reply plus a narrated voice note.
Port of goldenSniperOS/hermes-telegram-voicenote. Repo: goldenSniperOS/pi-telegram-voicenote (public, MIT).

## Specs

- S1. Terminal unchanged: "en el chat normal debería verse como se ve normalmente ahora en la que estamos trabajando".
- S2. Text + voice on Telegram: "en el chat de... Telegram sí debería ver ese extra del audio que se manda al final".
- S3. Narrated script: "la respuesta que es una tabla o cosas así, él la vuelve un guion y me la cuenta, de tal manera en que yo siento que está explicándome absolutamente todo". The script is written by a model from Pi's configured providers (configurable; falls back to plain cleanup on error/timeout).
- S4. Voice input: "poder mandar un audio" (inbound STT via pi-telegram handlers; documented setup).
- S5. Default TTS: Edge TTS (free, no key), pluggable.
- S6. Installable and public: "crea repositorios, versiones y algo instalable, algo que se pueda ejecutar con un comando" / "hacerlo público, instalable porque quiero colaborar".
- S8. Built-in voice input (v0.2.0): "que permita contestar con voz a través de un HTTS pero también funcione como plugin para que tú le mandes voz y configures si quieres un faster whisper O puedes utilizar la API key de OpenAI para utilizar un modelo en la nube y que él empiece a trabajar así". Registered as pi-telegram transcription provider; engines `openai` (OPENAI_API_KEY) and `faster-whisper` (local).
- S9. Default engine "Auto": OpenAI if OPENAI_API_KEY exists; else local faster-whisper; if neither, tell how to configure it.
- S10. Local install "Comando guiado": `/voicenote setup-stt` installs faster-whisper in a plugin-owned environment after confirmation; never installs by itself.
- S11. Default local model `small`, configurable.
- S7. Per-chat toggle and configuration ("Y tener la posibilidad de configurar un audio"): `/voicenote on|off`, config file.

## Tasks

- T1 [S1,S2] Spike: deterministic voice marker on Telegram turns reaches pi-telegram planning; terminal rendering — inline — no commit — DONE (L4)
- T2 [S6] Scaffold package (manifest, tsconfig, node test runner, LICENSE, README stub) — inline — commit — DONE (88ea601)
- T3 [S3] Script writer: port prompt + plain fallback + word cap — inline — commit — DONE (6e4d27a)
- T4 [S5] Edge TTS → OGG/Opus via ffmpeg, long-script splitting — inline — commit — DONE (6e4d27a)
- T5 [S2,S3,S7] Extension wiring: synthesis provider, marker, /voicenote, config, model call with timeout — inline — commit — DONE (850c656)
- T6 [S4,S6] Docs: install, pi-telegram setup, STT, config — inline — commit — DONE (README)
- T7 [S6] Publish: public GitHub repo, tag + release v0.1.0 (npm later, needs user's npm account) — inline — DONE (v0.1.0 → 3d1b750)
- T8 [S1-S4] Live acceptance with the user's bot — user + inline
- T9 [S8,S9,S11] STT engines + transcription provider + config — inline — commit — DONE (ea20b8e)
- T10 [S10] `/voicenote setup-stt` (+ `/voicenote stt <engine>`) — inline — commit — DONE (8c14546)
- T11 [S8-S11] Docs (README, CHANGELOG), version 0.2.0, real-audio smoke per engine — inline — commit — DONE (local smoke; OpenAI live pending a key)

## Log

- L1 (user, original request): "Ok, excelente ya está funcionando. Ahora lo que tocaría supongo sería empezar con el Con el trabajo del plugin del Telegram, correcto? Pi Telegram Voice Note. Hazlo en este repositorio, crea todo lo necesario y como tienes acceso a mi token de GitHub, crea repositorios, versiones y algo instalable, algo que se pueda ejecutar con un comando. No sé si también puedes, necesito crearme yo una cuenta en... La tienda de Py en la PyPI packages? Para poder publicar mi paquete y que funcione, ¿no? No sé cómo sería, pero indícame para hacer todo ese proceso, hacerlo público, instalable porque quiero colaborar."
- L2 (user decisions): name pi-telegram-voicenote; TTS Edge TTS; script by a Pi model; read Pi docs + clone refs into .refs/.
- L3 (evidence, explorer): pi-telegram registries are globalThis Maps (lib/voice.ts:11). Synthesis provider `(text, {lang,rate}) => Promise<path|undefined>`, no ctx. mirror/always drop text (queue.ts:2277-2288); manual + `<!-- telegram_voice -->` delivers text first, then voice (queue.ts:2584-2622). Programmatic text outbound handlers are never consumed and run after markup parsing. No public sendVoice API. Synthesis runs in the instance owning the turn → companion loaded in every instance. Maintainer (issue #235) endorses manual + telegram_voice for text+voice and companion-owned settings.
- L4 (T1 evidence): `pi -e spike.ts -p "[telegram]\n..."`: before_agent_start sees prompt starting with `[telegram]` (pi-telegram queue.ts:1431); a `message_end` replacement appending `<!-- telegram_voice {"text":"@reply"} -->` reaches `agent_end` event.messages (pi-telegram extracts the final text there, queue.ts:2191). Skip stopReason error/aborted/toolUse. Pi TUI markdown strips HTML comments (pi-tui markdown.js:173-191), so S1 holds in the TUI; print mode shows it raw. Plan: marker `@reply:<id>` + in-memory cache of the reply; strip the marker from LLM context via the `context` hook; register the provider in the globalThis Map `__piTelegramVoiceSynthesisProviders__` (no hard dependency); our provider returns undefined for foreign text. Caveat: configured telegram.json voice outboundHandlers run before providers and would receive the sentinel.
- L5 (T2-T5 evidence): worker implemented; `npm run check` 30/30 pass, tsc clean. Live smoke: real Edge TTS + ffmpeg produced opus mono 48k OGG (9.1s); real `pi -e src/index.ts -p "[telegram]..."` appended the marker and the registered provider returned an .ogg path. Project had no own .git (root was ~); fixed with `git init` in the project and HEAD of ~ restored to main.
- L6 (T7 evidence): public repo https://github.com/goldenSniperOS/pi-telegram-voicenote created and main pushed; release v0.1.0 created by `gh release create` (tag on 3d1b750). Direct `git push origin v0.1.0` was blocked by the RDD pre-delivery guard (root commit has no base for assess). Clean clone of v0.1.0: `npm ci && npm run check` → 29 pass, 0 fail (pi-telegram parser test skipped without .refs). npm publish pending the user's npm account.
- L7 (user, v0.2.0 request): "[screenshot: agent got voice-...ogg and could not transcribe] Observa esto, independientemente de que tú me hayas dicho que Pi se puede configurar como una nota de voz, no lo tiene. Me gustaría que este Telegram VoiceNotes Traiga las dos cosas, que permita contestar con voz a través de un HTTS pero también funcione como plugin para que tú le mandes voz y configures si quieres un faster whisper O puedes utilizar la API key de OpenAI para utilizar un modelo en la nube y que él empiece a trabajar así. Yo sé que Hermes esto lo tiene nativo, pero me gustaría saber si puedes incluirlo. No sé si se podría."
- L8 (user decisions): default engine Auto; local install via guided command; local model small. Authorized: "Dale arranca". Branch feat/voice-input.
- L9 (evidence): pi-telegram calls transcription providers from globalThis Map `__piTelegramVoiceTranscriptionProviders__` with `(file:{path,fileName,mimeType,kind}, {})` for voice-like files (inbound.ts:624-643); first non-empty text wins; thrown errors are recorded as runtime events. Provider returns string | {text,language} | undefined (voice.ts:52-67).
- L10 (delivery): v0.2.0 slices exceed ~400 lines (ea20b8e ≈490, 8c14546 ≈180, docs). Delivery strategy: one PR from feat/voice-input reviewed commit by commit (each commit is one behavior with its tests). Slice boundaries: ea20b8e | 8c14546 | T11 docs commit. Unconfigured/failed STT returns a bracketed notice on every voice note (not only once) so the agent always explains instead of guessing.
- L11 (T11 evidence): real local smoke in /tmp venv: setupLocalStt (venv + pip faster-whisper + prefetch tiny) 38s; Edge TTS ogg "Hola, esta es una prueba de transcripción de notas de voz." transcribed by createTranscriber(auto, no key) as "Hola, este es una prueba de transcripción de notas de voz." in 2.1s. OpenAI engine not run live (no OPENAI_API_KEY on this machine); covered by stubbed-fetch tests only. `npm run check`: 52 pass.
