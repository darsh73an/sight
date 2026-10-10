# ErrSight

A Sentry-lite error tracking platform. Drop a JS SDK into your app;
when it crashes, the error shows up on a dashboard, automatically
grouped by root cause, with alerts on new bugs.

## Problem statement

When something breaks in production:
- Users hit errors long before developers find out
- The same bug can generate thousands of nearly-identical crash logs -
  without grouping, that's just noise
- Raw logs rarely say which release caused it, or how many users were
  affected

ErrSight solves this with automatic error capture, fingerprint-based
grouping, and a dashboard that shows what's actually broken - not a
firehose of duplicate events.

## Architecture

```
 Browser / Node app
        |
        | throws
        v
 [ ErrSight JS SDK ]
        | fetch, fire-and-forget
        v
 [ Ingestion API ]  <-- fast-ack, <50ms, no DB writes here
   (POST /api/ingest, x-api-key auth, rate limited)
        |
        | queue.add()
        v
 [ Redis + BullMQ queue ]
        |
        | worker pulls jobs (concurrency: 5)
        v
 [ Background Worker ]
   scrub PII -> fingerprint -> find/create group -> save event -> alert if new
        |
        v
 [ PostgreSQL ]
   users, projects, error_groups, error_events
        ^
        |
 [ Dashboard API ]  <-- JWT auth
   GET  /api/projects/:id/errors
   GET  /api/errors/:groupId
   POST /api/errors/:groupId/resolve
        ^
        |
 [ React Dashboard ]
   login -> project selector -> error list -> error detail -> resolve
```

The core design decision: the request path (ingestion) never touches
Postgres or does grouping work. It only pushes to Redis and returns.
All the expensive work (scrubbing, fingerprinting, DB writes, alerting)
happens in the worker, off the critical path - so a traffic spike from
crashing clients can't take down the API that's supposed to be
recording those crashes.

## Tech stack

| Layer      | Tech                                          |
|------------|------------------------------------------------|
| Backend    | Node.js, Express, TypeScript                   |
| Database   | PostgreSQL (raw SQL via `pg`, no ORM)          |
| Queue      | Redis + BullMQ                                 |
| Frontend   | React, TypeScript, Vite, React Router, Axios   |
| SDK        | TypeScript, native `fetch`, zero runtime deps  |
| Auth       | JWT (dashboard), API key (SDK ingestion)       |
| Infra      | Docker, docker-compose                         |

## Setup

### Prerequisites
- Node.js 18+
- Docker + docker-compose

### Option A: Docker (recommended - runs everything)
```bash
cp .env.example .env   # set a real JWT_SECRET - required, not optional (see below)

# One-time: Docker builds use `npm ci`, which requires a committed
# package-lock.json - generate it once per package before your first build.
npm install --package-lock-only
(cd dashboard && npm install --package-lock-only)
(cd sdk/javascript && npm install --package-lock-only)

docker-compose up --build
```
`JWT_SECRET` has no insecure fallback here - both docker-compose and the
app itself refuse to start without it set (development mode still falls
back to a dev-only default for convenience). Set `CORS_ORIGIN` too if the
dashboard will be served from a different origin than the API; it only
gates the JWT-authed dashboard routes, never `/api/ingest`.
This starts Postgres, Redis, runs migrations once, then starts the API
(`:4000`) and the worker. To seed demo data into the running stack:
```bash
docker-compose exec migrate npx tsx scripts/seed.ts
```

### Option B: Local dev (backend pieces run separately)
```bash
# 1. Start just the infra
docker-compose up postgres redis

# 2. Backend
cp .env.example .env
npm install
npm run migrate
npm run dev        # API on :4000
npm run worker     # separate terminal

# 3. Dashboard
cd dashboard
npm install
npm run dev         # on :5173, proxies /api to :4000

# 4. SDK (only needed if you're developing the SDK itself)
cd sdk/javascript
npm install
npm run build
```

### Verify it's working
```bash
npm run test                                   # unit tests: fingerprinting, PII scrubbing, rate limiting
npm run seed                                  # demo user + project + sample errors
npm run test:ingest -- <projectId> <apiKey>    # sends 5 events, expects 2 groups
npm run typecheck                              # tsc --noEmit, zero errors
npm run typecheck:scripts                      # same, for scripts/
npm audit --omit=dev                           # no known vulns in runtime deps
```

## API endpoints

| Method | Path                              | Auth        | Description                          |
|--------|------------------------------------|-------------|---------------------------------------|
| POST   | `/api/auth/register`               | none        | Create a user account (logs a verification link - see note below) |
| POST   | `/api/auth/login`                  | none        | Returns a short-lived `accessToken` + a rotating `refreshToken` |
| POST   | `/api/auth/refresh`                | none        | Exchanges a refresh token for a new access+refresh pair (old one revoked) |
| POST   | `/api/auth/logout`                 | none        | Revokes a refresh token server-side   |
| POST   | `/api/auth/verify-email`           | none        | Verifies the token from a registration email |
| POST   | `/api/auth/forgot-password`        | none        | Logs a reset link (see note below)    |
| POST   | `/api/auth/reset-password`         | none        | Resets password, revokes all sessions |
| GET    | `/api/projects`                    | JWT         | List the caller's projects            |
| POST   | `/api/projects`                    | JWT         | Create a project (generates api_key)  |
| GET    | `/api/projects/:id`                | JWT         | Get one project                       |
| DELETE | `/api/projects/:id`                | JWT         | Delete a project                      |
| POST   | `/api/projects/:id/regenerate-key` | JWT         | Issues a new API key, invalidates the old one |
| GET    | `/api/projects/:id/errors`         | JWT         | List error groups (`?status=`, `?level=`, `?limit=`, `?cursor=` - cursor-based, not offset) |
| POST   | `/api/ingest`                      | x-api-key   | SDK sends an error event (fast-ack)   |
| GET    | `/api/errors/:groupId`             | JWT         | Group detail + last 20 events         |
| POST   | `/api/errors/:groupId/resolve`     | JWT         | Mark a group resolved                 |
| GET    | `/health`                          | none        | Liveness check                        |

## Known limitation: email delivery

No email provider (SendGrid/SES/SMTP) is wired up. Registration and
password-reset verification links are **logged via `logger.info`**, not
actually emailed — grep the API's logs for the link when testing these
flows locally (`docker-compose logs api`). The verification/reset
mechanism itself (tokens, expiry, one-time-use enforcement) is fully
built; only the "send it somewhere" step is a stub. Wiring a real
provider means adding an email-sending call where those `logger.info`
lines are in `src/routes/auth.ts`.

## Project structure

```
errsight/
├── src/            backend (Express API)
├── sdk/javascript/  browser + Node SDK, own package
├── dashboard/       React + Vite frontend
├── migrations/       SQL schema, applied in order
└── scripts/          migrate / seed / test-ingest tooling
```
