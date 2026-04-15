# CLAUDE.md

## Project
Audio/video → SRT transcription app. Gemini STT + Groq cleanup + speaker diarization. Stripe subscription + credit system. Deployed Netlify (front) + Express (back).

## Tech Stack
- Frontend: Vanilla JS, HTML/CSS, FFmpeg.js (Web Worker), Firebase auth
- Backend: Express.js, Firebase Admin, Gemini API, Groq API, Stripe, Multer, Nodemailer
- Deploy: Netlify (`netlify.toml` sets COOP headers), backend Node 18+

## Architecture
```
root/
  index.html              # SPA entry
  styles.css              # All styles (Pearl Warm theme, dark/light via data-theme)
  app.core.state.js       # State, DOM refs, theme toggle, localStorage
  app.core.ui.js          # UI updates, progress, stepper
  app.transcriptor.flow.js # Upload flow → POST /api/transcribe
  app.review.preview.js   # SRT viewer, speaker overlay
  app.review.wording.js   # Groq text cleanup
  app.summary.flow.js     # Episode summary
  srt-core.js             # SRT generation
  worker.js               # FFmpeg audio extraction (Web Worker)
  assets/wall/            # 20 local MP4s for video wall background
backend/
  server.js               # Express entry, all routes
  transcription.js        # handleTranscription(), Gemini STT
  gratuit.js              # Chunking, diarization (MFCC clustering)
  auth.js                 # Firebase token middleware
  db.js                   # Credits/plans (JSON file store)
  mailer.js               # Welcome email
```

## Critical Rules
- **NEVER touch transcription logic**: `transcription.js`, `gratuit.js`, `srt-core.js`, `worker.js`
- Auth: `Authorization: Bearer <Firebase idToken>` on all `/api/*` routes
- SharedArrayBuffer requires COOP headers (netlify.toml) — don't remove
- `data-theme` on `<html>` drives all theming — never hardcode colors in JS

## Current State
- ✅ Transcription, diarization, SRT export, Stripe webhooks, auth
- ✅ Video wall background (20 burned-subtitle MP4s via FFmpeg, local)
- ⚠️ Stripe PRICE_IDs not set in .env (6 vars needed)
- ⚠️ Firebase OAuth origin `localhost:8787` not added to GCP

## Key Commands
```bash
npm run dev:backend      # nodemon backend (port 8787)
npm run serve:front      # static front
# Production: node backend/server.js
```
