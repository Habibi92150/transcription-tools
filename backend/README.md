# Backend local (Node + whisper.cpp)

Ce backend transcrit (whisper.cpp local **ou** API Groq audio comme le front `main`) puis étiquette les tours de parole par **diarisation locale** (features audio + clustering, avec repli heuristique) ou, si activé, **overlay locuteurs Gemini** sur les timecodes STT.

## Prérequis

- Node.js 18+
- Un binaire `whisper-cli` (par défaut : `backend/bin/whispercpp/Release/whisper-cli.exe`)
- Un modèle whisper.cpp local (par défaut : `backend/models/ggml-base.bin`)
- **ffmpeg** dans le `PATH` (ou `FFMPEG_BIN` dans `.env`) — requis pour convertir MP3/MP4 en WAV avant la diarisation locale. Sans ffmpeg, seuls les fichiers déjà en WAV PCM sont diarisés correctement.

## Variables d'environnement

- `PORT` (défaut `8787`)
- `FFMPEG_BIN` (défaut `ffmpeg`) — conversion audio → WAV 16 kHz mono pour la diarisation
- `STT_ENGINE` (`whisper-cpp`, `groq` ou `gemini`) — avec `groq`, même endpoint que le déploiement `main` (`/audio/transcriptions`, `whisper-large-v3-turbo`, `verbose_json`). Clé : `GROQ_API_KEY` ou header `x-groq-api-key`. Repli automatique sur whisper.cpp si Groq échoue. Avec `gemini`, transcription + locuteurs via Gemini en **un** appel ; **les timestamps sont inférés par le modèle** (souvent imprécis pour du montage) et le texte peut être paraphrasé — pour des **TC fiables**, utiliser `groq` ou `whisper-cpp` + diarisation. La diarisation locale est sautée si `gemini` (déjà dans les segments).
- `GROQ_STT_MODEL` (défaut `whisper-large-v3-turbo`)
- `GROQ_STT_TEMPERATURE` (défaut `0`)
- `GROQ_STT_TIMEOUT_MS` (défaut `600000`, fichiers longs)
- `TEXT_CLEANUP_PROVIDER` (`none`, `groq` ou `gemini`)
- `GROQ_API_KEY` (optionnel, utilisé si pas de header `x-groq-api-key`)
- `GROQ_BASE_URL` (défaut `https://api.groq.com/openai/v1`)
- `GROQ_CLEANUP_MODEL` (défaut `llama-3.1-8b-instant`)
- `GROQ_TIMEOUT_MS` (défaut `60000`)
- `GROQ_CONTEXT_WINDOW` (défaut `5`, nb de segments de contexte avant/après)
- `GROQ_GLOBAL_CONTEXT_CHARS` (défaut `1800`, extrait global de la transcription injecté dans le prompt)
- `GROQ_CLEANUP_HINTS` (optionnel, noms/sujets séparés par virgule pour biaiser les corrections de noms propres sur une émission)
- `GROQ_SUMMARY_MODEL` / `GROQ_SUMMARY_TEMPERATURE` — résumé d'épisode via Groq (défaut si `SUMMARY_PROVIDER=groq`)
- `SUMMARY_PROVIDER` (`groq` ou `gemini`) — moteur LLM pour `/api/episode-summary` (surcharge possible via en-tête `x-summary-provider`)
- `GEMINI_API_KEY` — clé [Google AI Studio](https://aistudio.google.com/) / Gemini API (ou en-tête `x-gemini-api-key`)
- `GEMINI_API_BASE` (défaut `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_MODEL` — STT audio via Gemini quand `STT_ENGINE=gemini` (défaut `gemini-2.5-flash`)
- `GEMINI_DIARIZATION_MODEL` (défaut = `GEMINI_MODEL`) — modèle utilisé **uniquement** pour l'appel audio supplémentaire `GEMINI_DIARIZATION_OVERLAY=1` (interlocuteurs alignés sur les timecodes Groq/whisper).
- `GEMINI_SUMMARY_MODEL` (défaut `gemini-2.5-flash`)
- `GEMINI_SUMMARY_TEMPERATURE` / `GEMINI_TIMEOUT_MS`
- `GEMINI_CLEANUP_MODEL` / `GEMINI_CLEANUP_TEMPERATURE` — cleanup texte des segments (`TEXT_CLEANUP_PROVIDER=gemini`) sans modifier TC/speakers
- `GEMINI_DIARIZATION_OVERLAY` (`0`/`1`) — en `STT_ENGINE=groq|whisper-cpp`, conserve les timecodes STT et remplace uniquement les speakers par Gemini (appel supplémentaire, modèle = `GEMINI_DIARIZATION_MODEL`). Si Gemini échoue, repli sur la **diarisation locale**.
- `GEMINI_OVERLAY_MIN_SPEAKER_SEC` / `GEMINI_OVERLAY_MIN_SPEAKER_SEGMENTS` / `GEMINI_OVERLAY_SMOOTHING_CONFIDENCE` — réglages anti-fusion des locuteurs rares lors du `gemini-speaker-overlay`.
- `WHISPER_CPP_BIN` (défaut : binaire local précompilé)
- `WHISPER_MODEL_PATH` (défaut : modèle local `ggml-base`)
- `WHISPER_LANGUAGE` (défaut `fr`)
- `DIARIZATION_MAX_SPEAKERS` (défaut `2`)
- `DIARIZATION_MIN_GAP_SEC` (défaut `1.8`)
- `DIARIZATION_MIN_TURN_SEC` (défaut `10`)
- `DIARIZATION_MIN_TURN_SEGMENTS` (défaut `4`)
- `DIARIZATION_SWITCH_COOLDOWN_SEC` (défaut `6`)
- `DIARIZATION_MIN_FEATURE_SEC` (défaut `0.7`)
- `DIARIZATION_MIN_CLUSTER_SEGMENTS` (défaut `3`)
- `DIARIZATION_VOICE_DISTANCE_THRESHOLD` (défaut `0.85`)
- `DIARIZATION_FRAME_SEC` (défaut `0.9`)
- `DIARIZATION_HOP_SEC` (défaut `0.35`)
- `DIARIZATION_CONTINUITY_BONUS` (défaut `0.2`)
- `WHISPER_BEAM_SIZE` (défaut `8`)
- `WHISPER_BEST_OF` (défaut `8`)
- `MAX_FILE_MB` (défaut `600` dans le code si absent ; en prod épisodes longs, monter ex. `10240` ≈ 10 Go — aligner aussi `client_max_body_size` sous Nginx)

## Lancement

```bash
npm run start:backend
```

## Diarisation

Sur `STT_ENGINE=groq` ou `whisper-cpp`, le backend applique **diarisation locale** (clustering de signaux voix + repli heuristique par gaps) sauf si `GEMINI_DIARIZATION_OVERLAY=1` et qu'un appel Gemini fournit des locuteurs alignés sur les segments STT.

Si `TEXT_CLEANUP_PROVIDER=groq` ou `gemini`, une passe de correction orthographique FR s'applique ensuite sans modifier les timestamps/speakers (avec fallback déterministe en cas d'échec Groq).

## Endpoints

### `GET /health`

Retourne l'état du backend (`diarizationProvider` vaut toujours `"local"` côté API).

### `POST /api/transcribe`

`multipart/form-data` avec champ `file`.

Réponse (exemple) :

```json
{
  "segments": [
    { "start": 1.2, "end": 3.4, "text": "Bonjour", "speaker": "SPEAKER_00" }
  ],
  "meta": {
    "engine": "groq-audio+diarization",
    "stt": "groq:whisper-large-v3-turbo",
    "diarization": "voice-features-v2",
    "language": "fr",
    "textCleanup": "groq-cleanup-context-5"
  }
}
```

### `POST /api/align-speakers`

`multipart/form-data` : champ `file` (même piste audio) + champ `segments` (JSON string, tableau `{ start, end, text }`).

Pas de STT ni Gemini : applique uniquement la **diarisation locale** puis fusion avec le texte. (Le front **Gratuit** ne l'appelle plus ; endpoint conservé pour intégrations ou outils.)

Réponse : `{ "segments": [...], "meta": { "diarization", "diarizationProvider": "local" } }`.

### `POST /api/episode-summary`

`multipart/form-data` avec champ `file`.

En-têtes / configuration :

- Transcription (étape STT): `x-groq-api-key` ou `GROQ_API_KEY` si `STT_ENGINE=groq` ; sinon whisper.cpp local.
- Résumé LLM: `SUMMARY_PROVIDER` (`groq` ou `gemini`) dans `.env`, ou en-tête `x-summary-provider: groq|gemini`.
  - **Groq**: `GROQ_API_KEY` ou `x-groq-api-key` (requis pour l'étape résumé).
  - **Gemini**: `GEMINI_API_KEY` ou `x-gemini-api-key`.

Réponse :

```json
{
  "summary": {
    "short": "Résumé court de l'épisode...",
    "long": "Résumé détaillé de l'épisode...",
    "keyPoints": ["Point clé 1", "Point clé 2"],
    "characters": ["Personnage A", "Personnage B"]
  },
  "meta": {
    "stt": "groq:whisper-large-v3-turbo",
    "summaryProvider": "groq",
    "summaryModel": "llama-3.3-70b-versatile",
    "segmentCount": 1342,
    "durationSec": 3589.12,
    "chunkCount": 7
  }
}
```
