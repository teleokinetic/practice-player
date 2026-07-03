# practice-player

Audio practice player (personal). Static page + TTS segments; transcription happens browser-side.

- `scripts/segments.json` — canonical narration text
- `scripts/build_audio.sh` — TTS render + loudness-normalize (needs OPENAI_API_KEY, ffmpeg)
- `index.html` — the player
