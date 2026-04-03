# Backend local (Node + whisper.cpp)

Ce backend transcrit (whisper.cpp local **ou** API Groq audio comme le front `main`) puis etiquette les tours de parole (diarization locale ou pyannote).
Le repo peut utiliser des binaires `whisper.cpp` precompiles pour le mode local STT.

## Prerequis

- Node.js 18+
- Un binaire `whisper-cli` (par defaut: `backend/bin/whispercpp/Release/whisper-cli.exe`)
- Un modele whisper.cpp local (par defaut: `backend/models/ggml-base.bin`)
- **ffmpeg** dans le `PATH` (ou `FFMPEG_BIN` dans `.env`) — requis pour convertir MP3/MP4 en WAV avant la diarisation (local ou pyannote). Sans ffmpeg, seuls les fichiers deja en WAV PCM sont diarisés correctement.

## Variables d'environnement

- `PORT` (defaut `8787`)
- `FFMPEG_BIN` (defaut `ffmpeg`) — conversion audio → WAV 16 kHz mono pour la diarisation
- `STT_ENGINE` (`whisper-cpp`, `groq` ou `gemini`) — avec `groq`, meme endpoint que le deploiement `main` (`/audio/transcriptions`, `whisper-large-v3-turbo`, `verbose_json`). Cle: `GROQ_API_KEY` ou header `x-groq-api-key`. Repli automatique sur whisper.cpp si Groq echoue. Avec `gemini`, transcription + locuteurs via Gemini en **un** appel ; **les timestamps sont inferes par le modele** (souvent imprecis pour du montage) et le texte peut etre paraphrase — pour des **TC fiables**, utiliser `groq` ou `whisper-cpp` + diarization. La diarization pyannote / locale est sautee si `gemini` (deja dans les segments).
- `GROQ_STT_MODEL` (defaut `whisper-large-v3-turbo`)
- `GROQ_STT_TEMPERATURE` (defaut `0`)
- `GROQ_STT_TIMEOUT_MS` (defaut `600000`, fichiers longs)
- `DIARIZATION_PROVIDER` (`local` ou `pyannote-service`)
- `DIARIZER_URL` (defaut `http://127.0.0.1:8790`)
- `DIARIZER_API_KEY` (optionnel, recommande)
- `DIARIZER_TIMEOUT_MS` (defaut `180000`)
- `TEXT_CLEANUP_PROVIDER` (`none`, `groq` ou `gemini`)
- `GROQ_API_KEY` (optionnel, utilise si pas de header `x-groq-api-key`)
- `GROQ_BASE_URL` (defaut `https://api.groq.com/openai/v1`)
- `GROQ_CLEANUP_MODEL` (defaut `llama-3.1-8b-instant`)
- `GROQ_TIMEOUT_MS` (defaut `60000`)
- `GROQ_CONTEXT_WINDOW` (defaut `5`, nb de segments de contexte avant/apres)
- `GROQ_GLOBAL_CONTEXT_CHARS` (defaut `1800`, extrait global de la transcription injecte dans le prompt)
- `GROQ_CLEANUP_HINTS` (optionnel, noms/sujets separes par virgule pour biaiser les corrections de noms propres sur une emission)
- `GROQ_SUMMARY_MODEL` / `GROQ_SUMMARY_TEMPERATURE` — résumé d'épisode via Groq (défaut si `SUMMARY_PROVIDER=groq`)
- `SUMMARY_PROVIDER` (`groq` ou `gemini`) — moteur LLM pour `/api/episode-summary` (surcharge possible via en-tête `x-summary-provider`)
- `GEMINI_API_KEY` — clé [Google AI Studio](https://aistudio.google.com/) / Gemini API (ou en-tête `x-gemini-api-key`)
- `GEMINI_API_BASE` (defaut `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_MODEL` — STT audio via Gemini quand `STT_ENGINE=gemini` (defaut `gemini-2.5-flash` ; preview ex. `gemini-3-flash-preview` possible mais plus lent)
- `GEMINI_DIARIZATION_MODEL` (defaut = `GEMINI_MODEL`) — modele utilise **uniquement** pour l'appel audio supplementaire `GEMINI_DIARIZATION_OVERLAY=1` (interlocuteurs alignes sur les timecodes Groq/whisper). Permet ex. `gemini-3-flash-preview` ou `gemini-3.1-flash-lite-preview` pour les speakers tout en gardant un `GEMINI_MODEL` plus leger si tu passes plus tard en STT Gemini.
- `GEMINI_SUMMARY_MODEL` (defaut `gemini-2.5-flash`)
- `GEMINI_SUMMARY_TEMPERATURE` / `GEMINI_TIMEOUT_MS`
- `GEMINI_CLEANUP_MODEL` / `GEMINI_CLEANUP_TEMPERATURE` — cleanup texte des segments (`TEXT_CLEANUP_PROVIDER=gemini`) sans modifier TC/speakers
- `GEMINI_DIARIZATION_OVERLAY` (`0`/`1`) — en `STT_ENGINE=groq|whisper-cpp`, conserve les timecodes STT et remplace uniquement les speakers par Gemini (appel supplementaire, modele = `GEMINI_DIARIZATION_MODEL`). Si Gemini échoue, fallback automatique sur la diarization configuree (`pyannote-service` ou `local`).
- `GEMINI_OVERLAY_MIN_SPEAKER_SEC` / `GEMINI_OVERLAY_MIN_SPEAKER_SEGMENTS` / `GEMINI_OVERLAY_SMOOTHING_CONFIDENCE` — réglages anti-fusion des locuteurs rares (3+ intervenants) lors du `gemini-speaker-overlay`.
- `WHISPER_CPP_BIN` (defaut: binaire local precompile)
- `WHISPER_MODEL_PATH` (defaut: modele local `ggml-base`)
- `WHISPER_LANGUAGE` (defaut `fr`)
- `DIARIZATION_MAX_SPEAKERS` (defaut `2`)
- `DIARIZATION_MIN_GAP_SEC` (defaut `1.8`)
- `DIARIZATION_MIN_TURN_SEC` (defaut `10`)
- `DIARIZATION_MIN_TURN_SEGMENTS` (defaut `4`)
- `DIARIZATION_SWITCH_COOLDOWN_SEC` (defaut `6`)
- `DIARIZATION_MIN_FEATURE_SEC` (defaut `0.7`)
- `DIARIZATION_MIN_CLUSTER_SEGMENTS` (defaut `3`)
- `DIARIZATION_VOICE_DISTANCE_THRESHOLD` (defaut `0.85`)
- `DIARIZATION_FRAME_SEC` (defaut `0.9`)
- `DIARIZATION_HOP_SEC` (defaut `0.35`)
- `DIARIZATION_CONTINUITY_BONUS` (defaut `0.2`)
- `WHISPER_BEAM_SIZE` (defaut `8`)
- `WHISPER_BEST_OF` (defaut `8`)
- `MAX_FILE_MB` (defaut `600` dans le code si absent ; en prod épisodes longs, monter ex. `10240` ≈ 10 Go — aligner aussi `client_max_body_size` sous Nginx)

## Lancement

```bash
npm run start:backend
```

## Mode diarization "max quality" (pyannote)

### Option A — Python natif (recommande pour dev local sous Windows)

1) Creer un token Hugging Face (gratuit) avec acces au modele `pyannote/speaker-diarization-3.1`.
2) Dans `backend/.env`, definir:
   - `HF_TOKEN=...`
   - `DIARIZATION_PROVIDER=pyannote-service`
   - `DIARIZER_URL=http://127.0.0.1:8790`
3) Installer les deps Python:

```bash
npm run setup:diarizer-python
```

4) Lancer le diarizer Python:

```bash
npm run start:diarizer-python
```

5) Verifier (`hfTokenConfigured` doit etre `true` avant `/diarize`) :

```bash
curl http://127.0.0.1:8790/health
```

Le service demarre meme sans `HF_TOKEN` ; `/health` indique si le token est configure. Sans token, `POST /diarize` repond 503 avec un message explicite.

### Option B — Docker (si WSL/virtualisation fonctionne)

```bash
docker compose -f docker-compose.diarizer.yml up --build
```

Le backend Node fusionnera automatiquement les segments pyannote avec les segments Whisper.
Si `TEXT_CLEANUP_PROVIDER=groq`, il applique ensuite une passe de correction orthographique FR sans modifier les timestamps/speakers.
La passe Groq utilise le contexte local des segments + un fallback deterministe FR (elisions/contractions/negations evidentes).

## Endpoint

### `GET /health`
Retourne l'etat du backend.

### `POST /api/transcribe`
`multipart/form-data` avec champ `file`.

Reponse:

```json
{
  "segments": [
    { "start": 1.2, "end": 3.4, "text": "Bonjour", "speaker": "SPEAKER_00" }
  ],
  "meta": {
    "engine": "groq-audio+diarization",
    "stt": "groq:whisper-large-v3-turbo",
    "diarization": "pyannote-service",
    "language": "fr",
    "textCleanup": "groq-cleanup-context-5"
  }
}
```

> Note: en `DIARIZATION_PROVIDER=local`, le backend utilise un clustering de features de voix (2 locuteurs robustes) avec fallback. En `pyannote-service`, il utilise le diarizer dedie (recommande pour >2 locuteurs) puis fallback local en cas d'indisponibilite.

### `POST /api/episode-summary`
`multipart/form-data` avec champ `file`.

En-têtes / configuration:

- Transcription (étape STT): `x-groq-api-key` ou `GROQ_API_KEY` si `STT_ENGINE=groq` ; sinon whisper.cpp local.
- Résumé LLM: `SUMMARY_PROVIDER` (`groq` ou `gemini`) dans `.env`, ou en-tête `x-summary-provider: groq|gemini`.
  - **Groq**: `GROQ_API_KEY` ou `x-groq-api-key` (requis pour l'étape résumé).
  - **Gemini**: `GEMINI_API_KEY` ou `x-gemini-api-key`.

Reponse:

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
