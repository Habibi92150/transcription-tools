## Plan d'implementation diarization self-hosted

Objectif: conserver le flux actuel, ajouter un mode backend Node local/heberge, et injecter la diarization uniquement apres extraction audio (quand `fileToSend` est pret).

### 1) Frontend: mode pipeline configurable
- Ajouter un mode `Backend local` vs `Groq direct`.
- Conserver le mode Groq existant comme fallback.
- Stocker le mode et l'URL backend en `localStorage`.

### 2) Point d'injection impose
- Dans `runBtn.onclick`, garder la preparation identique.
- Apres extraction (`fileToSend = await extractAudioTrack(...)`), appeler le backend diarization/transcription.
- Ne rien faire avant cette etape pour la diarization.

### 3) Contrat API backend
- Endpoint: `POST /api/transcribe`
- Payload: `multipart/form-data` avec `file`.
- Reponse JSON normalisee:
  - `segments`: `[{ start, end, text, speaker? }]`
  - `meta`: infos techniques optionnelles.

### 4) Backend Node self-hosted (sans API payante)
- Ajouter un serveur Node minimal avec upload.
- Ajouter un adaptateur STT local (whisper.cpp CLI) declenche par `child_process`.
- Ajouter un adaptateur diarization local initial (MVP), evolutif vers VAD+embeddings+clustering.
- Toujours renvoyer un JSON compatible avec le frontend.

### 5) Fusion locuteurs + segments
- Si `speaker` deja present dans `segments`: utilisation directe.
- Sinon, fallback sans diarization (comportement identique a aujourd'hui).

### 6) SRT: extension non destructive
- Conserver `toSrt(segments)` tel quel.
- Ajouter `toSrtWithSpeakers(segments, options)` pour prefixer `SPEAKER_XX`.
- Timestamp SRT strictement inchange.

### 7) Robustesse / fallback
- Si backend indisponible: message d'erreur clair.
- Si diarization manquante: generation SRT standard.
- Aucun changement sur `worker.js`.

### 8) Validation locale
- Cas MP4 -> extraction audio -> backend.
- Cas MP3 direct -> backend.
- Cas erreur backend -> gestion UI/stepper.
- Verification du format `HH:MM:SS,mmm --> HH:MM:SS,mmm`.

### 9) Deploiement futur
- Front sur Netlify.
- Backend sur AWS (EC2/ECS) derriere `api.domaine`.
- Variables d'environnement pour chemins binaires et modeles.
