# CollectFlo

## Setup

1. Copy env file and fill values
   cp .env.example .env

2. Install deps
   npm ci

3. Start Postgres/Redis (optional via Docker)
   docker compose up -d postgres redis

4. Run migrations
   npm run migrate:run

5. Start app
   npm run dev

## Environment variables

Key vars:
- DATABASE_URL: Postgres connection string
- SESSION_SECRET: session and encryption base secret
- JWT_ACCESS_SECRET / JWT_REFRESH_SECRET: JWT signing secrets
- CORS_ALLOWED_ORIGINS: comma-separated list (e.g. http://localhost:3000,http://localhost:5173)
- QBO_*: QuickBooks config
- SENDGRID_*, TWILIO_*, STRIPE_*: integrations

See `.env.example` for a complete list with local defaults.

## Notes
- Debug HTML pages are blocked in production; use `/api/__debug/*` only in non-prod.
- Migrations are under `db/migrations` and run via `npm run migrate:run`.

## Deployment runbook (staging → prod)

1) Snapshot the database
- Take a managed backup or manual dump before changes.

2) Preflight check (staging)
- Set `DATABASE_URL` to staging DB and run:
  NODE_ENV=production DATABASE_URL=postgres://... DATABASE_SSL=true node backend/scripts/preflight-settings-migration.js
- If it exits non-zero, fix reported issues first (duplicates, missing users, etc.).

3) Run migrations (staging)
  NODE_ENV=production DATABASE_URL=postgres://... DATABASE_SSL=true npm run migrate:run

4) Smoke test (staging)
- Health: GET /health
- Auth: login/signup, /api/user-info
- QBO OAuth flow: /auth/qbo → callback, verify tokens saved and /api/qbo/company-info works
- Scheduler: GET /api/follow-ups/scheduler/status
- CORS: Load app from each front-end origin with no errors

5) Prepare production env vars
- Ensure: SESSION_SECRET (unchanged), JWT_* secrets, CORS_ALLOWED_ORIGINS, QBO_*, SENDGRID_*, TWILIO_*, STRIPE_*

6) Deploy to production
- Prefer rolling deploy. Ensure migrations run (either pre-run or at startup).

7) Post-deploy checks
- Repeat smoke tests on production
- Watch logs for errors/slow queries

8) Rollback plan
- If errors occur, revert the PR and restore the DB snapshot.
