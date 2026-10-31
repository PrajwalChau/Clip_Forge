# ClipForge

ClipForge is a local-first MERN application for turning **authorized** long-form video into reviewable vertical clips. The product never presents AI recommendations, payment states, or processing output as real unless the underlying provider and media steps succeeded.

## What is implemented

- React + Vite + TypeScript workspace, based on the supplied ClipForge Stitch visual language: warm off-white canvas, slate panels, restrained terracotta actions, editorial headings, and a responsive creator workspace.
- Landing, registration/sign-in, projects, direct video upload, processing status, clip library, storage & usage, plans & billing, and account settings screens.
- HTTP-only signed JWT session cookies; bcrypt password hashing; rate limits; Helmet; constrained CORS; Zod request validation; centralized errors; and ownership checks on every private route.
- MongoDB models for users, projects, video assets, clips, processing jobs, subscriptions, payments, and monthly usage.
- Atomic MongoDB reservations for storage, source-duration processing time, and requested clip count so concurrent uploads/jobs cannot oversubscribe a plan.
- Local development storage plus a Cloudflare R2/S3-compatible storage adapter with short-lived download URLs.
- A real job workflow: MP4/FFprobe validation, a required user rights declaration, local Whisper transcription, configuration-aware Gemini or transcript fallback selection, validated timestamps, FFmpeg 9:16 rendering, generated SRT subtitles, output quality checks, plan watermarking, durable asset records, cleanup, cancellation of queued work, and bounded BullMQ retries.
- Configurable free, Pro, and Premium plan entitlements. Only successful clip output consumes generated-clip allowance; failed or cancelled jobs release their reserved processing allowance. Storage reservation is committed only after the object write succeeds.
- Provider-isolated payment foundation. The test adapter creates **pending test data** and only activates an account after explicit server-side test verification. Live eSewa/Khalti checkout remains intentionally disabled pending approved, documented merchant integrations.

## Project structure

```text
.
├── backend/
│   ├── src/{config,controllers,middleware,models,routes,services,utils,workers,tests}
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/{components,context,pages,services,utils}
│   ├── .env.example
│   └── package.json
├── package.json
└── README.md
```

## Prerequisites

- Node.js 22 or newer (the repository includes `.nvmrc`)
- MongoDB 7+ locally or a MongoDB Atlas development cluster
- Redis 7+ if using the default `QUEUE_MODE=bullmq`; use `QUEUE_MODE=inline` only for an isolated local development worker
- FFmpeg and FFprobe available on your PATH
- Local Whisper (`openai-whisper`) for the default real transcript path; optionally, OpenAI transcription credentials can be used instead
- Optional: Gemini credentials for AI-assisted clip ranking. Without it, ClipForge uses an explicitly labelled transcript-based fallback; it never claims that fallback is AI analysis.
- Optional: Cloudflare R2 credentials for cloud storage

## Install and run locally

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Set the following in `backend/.env` for genuine local media processing:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/clipforge
JWT_SECRET=replace-this-with-a-unique-random-secret-of-32-or-more-characters
QUEUE_MODE=inline
STORAGE_PROVIDER=local
VIDEO_PROCESSING_MODE=real
TRANSCRIPTION_PROVIDER=whisper_local
WHISPER_COMMAND=whisper
WHISPER_MODEL=base
AI_PROVIDER=none
```

Then run:

```bash
npm run dev
```

The web app is served at `http://localhost:5173`; the API is on `http://localhost:4000`.

For a zero-setup local preview when MongoDB is not installed, run:

```bash
npm run dev:memory
```

This starts the API with an isolated in-memory MongoDB instance and the frontend together. It is appropriate only for local interface and authentication testing: all accounts, projects, and settings are erased when that process stops. Use the normal `npm run dev` command with a configured `MONGODB_URI` for persistent development data.

`TRANSCRIPTION_PROVIDER=none` is a deliberately honest configuration state: uploads work, but a real processing job stops with a clear configuration error rather than inventing a transcript. Set `TRANSCRIPTION_PROVIDER=whisper_local` for local Whisper, or `TRANSCRIPTION_PROVIDER=openai` with `TRANSCRIPTION_API_KEY` for the optional hosted adapter. `AI_PROVIDER=none` is valid: real timestamped transcripts are then processed with the clearly marked transcript fallback. Set `AI_PROVIDER=gemini` and `AI_API_KEY` only when you want optional AI-assisted selection. `GEMINI_MODEL` defaults to `gemini-2.5-flash` and can be changed to another model available to your Gemini account.

`npm run dev:memory` is an intentional **demo mode**: it uses an ephemeral database and labelled mock transcript/selection data, while still exercising the real FFmpeg rendering path. It is only for interface and workflow preview, never for interpreting source speech or publishing decisions.

## Worker operation and deployment

For a durable local/production-like setup, run Redis and use the API and worker as separate processes:

```bash
# backend/.env
QUEUE_MODE=bullmq
WORKER_MODE=separate
REDIS_URL=redis://127.0.0.1:6379

# terminal 1
npm run dev

# terminal 2
npm run worker:dev
```

The worker owns FFmpeg rendering and transcription. It uses a configurable concurrency of 1–4, retries BullMQ jobs with exponential backoff, removes per-job temporary media, and periodically purges stale work directories while never touching active jobs.

For containerized MongoDB, Redis, API, and a Whisper-equipped worker:

```bash
cp backend/.env.example backend/.env
# Set a real JWT_SECRET (32+ characters).
docker compose up --build
```

The compose stack exposes the API on `http://localhost:4000`; run the Vite frontend separately with `npm run dev`, or deploy its production build behind your chosen HTTPS web server. The worker image installs FFmpeg and `openai-whisper`. The first Whisper request downloads the chosen model into the container cache, so pre-warm or mount a model cache in production.

For an HTTPS production deployment, update `backend/.env` to `NODE_ENV=production`, `COOKIE_SECURE=true`, and an exact HTTPS `FRONTEND_URL` before starting the stack. Put the frontend and API behind an HTTPS reverse proxy or otherwise ensure the browser only reaches them over HTTPS.

## Checks

```bash
npm run verify:services
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run verify:services` is read-only: it checks the configured MongoDB and Redis connections, FFmpeg/FFprobe, local Whisper, R2 bucket access when credentials are present, and the configured Gemini model. It never prints secret values or creates/deletes cloud objects.

To use R2 for an end-to-end local test, set `STORAGE_PROVIDER=r2`; entering R2 credentials alone intentionally leaves local storage active. For a separate BullMQ worker, set `QUEUE_MODE=bullmq` and `WORKER_MODE=separate`, then run `npm run worker:dev` beside the API/frontend process.

## API overview

All routes are under `/api/v1`.

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET/PATCH /auth/me`
- `GET/POST /projects`, `GET /projects/:projectId`, `POST /projects/:projectId/process`
- `GET /jobs`, `GET /jobs/:jobId`, `POST /jobs/:jobId/cancel`
- `POST /storage/upload`, `GET /storage/usage`, `GET /storage/files`, `POST /storage/download-url`, `DELETE /storage/files/:assetId`
- `GET /clips`, `GET/PATCH /clips/:clipId`, `POST /clips/:clipId/download-url`, `DELETE /clips/:clipId`
- `GET /plans`, `GET /subscriptions/me`, `GET /billing/history`, `POST /billing/checkout`
- `GET /health`

## Authentication and administration

Registration creates an ordinary `user` account on the Free plan only. Privilege, plan, account-status, password-hash, and session fields cannot be set through public registration or profile routes.

Sessions use signed, HTTP-only cookies. Mutating authenticated requests also require the matching CSRF cookie/header pair; the supplied frontend attaches the header automatically. Logout and account suspension increment a server-side session version, which invalidates previously issued sessions. Suspended accounts cannot sign in or use existing sessions.

The first administrator is intentionally created through a guarded server-side command, after registering that account normally. It assigns the existing Premium plan and removes only the monthly generated-clip cap; normal processing-time and storage safeguards remain in force. It refuses to proceed unless its email is repeated in `CLIPFORGE_BOOTSTRAP_CONFIRM`, and it refuses when an active administrator already exists:

```bash
CLIPFORGE_BOOTSTRAP_EMAIL=operator@example.com CLIPFORGE_BOOTSTRAP_CONFIRM=operator@example.com npm run admin:bootstrap
```

There is no browser-accessible role-promotion endpoint. Administrator pages and `/api/v1/admin/*` APIs require an active administrator session. The console provides read-only operational visibility by default, records audited account suspension/reactivation and safe job actions, and never exposes user passwords, session tokens, private media downloads, environment secrets, or payment-status overrides.

Admin routes are `/admin` (overview), `/admin/users`, `/admin/users/:userId`, `/admin/projects`, `/admin/jobs`, `/admin/clips`, `/admin/storage`, `/admin/subscriptions`, `/admin/payments`, `/admin/health`, `/admin/audit-logs`, and `/admin/settings`. Their API counterparts are grouped beneath `/api/v1/admin`; `PATCH /admin/users/:userId/status`, `POST /admin/jobs/:jobId/retry`, and `POST /admin/jobs/:jobId/cancel` are the only current administrative mutations.

For production, serve both applications over HTTPS, use a specific `FRONTEND_URL` (not a wildcard), set `COOKIE_SECURE=true`, and generate a unique, rotated `JWT_SECRET` of at least 32 characters. Keep the API and frontend on same-site origins unless you deliberately review and adapt the cookie and CSRF deployment model.

## Usage policy details

- Monthly usage is keyed to the UTC calendar month and resets at the next UTC month boundary.
- Failed and cancelled jobs consume no processing/clip allowance; they release the original reservation.
- The processing reservation uses source duration and requested count before a job starts. Successful output counts only the number of clips actually rendered.
- Free outputs are limited to 720p with a watermark and a seven-day rendered-clip retention date, with 15 generated clips per monthly cycle. Pro and Premium limits and retention dates are defined centrally in `backend/src/services/plans.ts`.
- Source and clip files can still be downloaded or deleted when a new upload is blocked by quota.
- Source uploads accept MP4 only in this MVP. The worker performs a second FFprobe validation and verifies each rendered MP4 before it is made available.
- A source must carry a user confirmation of rights. Optional license, creator, source URL, and attribution metadata is stored with that source. This is a provenance record, not automated legal verification.
- Clip scores are bounded quality estimates from the configured selector, not virality predictions. The UI records whether a clip came from AI selection, deterministic transcript fallback, or explicitly enabled demo data.

## Database collections

MongoDB stores `users`, `projects`, `videoassets`, `processingjobs`, `transcripts`, `clips`, `subscriptions`, `payments`, `usages`, and `auditlogs`. Ownership is included in every private content query; video bytes are stored only in the configured local/R2 object store and are served through authenticated, short-lived routes rather than public URLs.

## Test data helpers

There are no public demo credentials. For isolated development only, seed two ordinary test accounts with a password supplied at runtime:

```bash
CLIPFORGE_SEED_PASSWORD='choose-a-local-development-password' npm run seed:dev-users
```

The seed script refuses production mode. Create an administrator only through the guarded bootstrap command described below; never place administrator passwords in source control or docs.

## Before serving real customers

- Configure and test MongoDB backups, Redis persistence, R2 lifecycle cleanup, alerting, and worker resource limits in production.
- Verify current eSewa/Khalti merchant documentation and complete their sandbox/approval requirements before enabling a live payment adapter. Do not enable subscriptions from redirect URLs or client-submitted statuses.
- Set secure HTTPS cookies, exact production CORS origins, rotated secrets, object storage credentials, a public privacy policy, and upload/retention terms.
- Run end-to-end tests with an authorized non-sensitive sample video after FFmpeg, Redis, transcription, AI, and storage credentials are all configured.
- Local Mac processing is development infrastructure only; it is not an appropriate permanent paid-customer worker.
