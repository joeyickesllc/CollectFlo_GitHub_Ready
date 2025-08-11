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
