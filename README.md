# Yokai

Yokai is a private control room for running OpenClaw inside Vercel Sandbox. The UI is built with Next.js App Router, while Convex stores admin credentials, dashboard state, session data, command history, usage snapshots, and snapshot metadata.

## What It Does

- boot, stop, and sync an OpenClaw sandbox
- configure Telegram access, gateway credentials, default model, timeout, and Vercel project metadata
- auto-roll a sandbox before its TTL expires and restore it from the latest persisted snapshot
- bootstrap the first admin account from `/login`, then protect the dashboard with cookie-based sessions
- show recent OpenClaw sessions, tracked sandbox commands, and usage snapshots
- mask secrets in the UI and encrypt sensitive values before persisting them in Convex

## Stack

- Bun workspaces
- Next.js 16 App Router
- React 19
- Convex
- Vercel Sandbox
- Biome

## Project Layout

```text
.
├── apps/web
│   ├── src/app            # App Router pages, route handlers, server actions
│   ├── src/components     # Dashboard UI
│   ├── src/lib            # Auth, store, sandbox, gateway, security logic
│   ├── convex             # Convex schema, validators, queries, mutations
│   └── .env.example       # Local environment template
├── package.json           # Workspace-level scripts
└── README.md
```

## Environment

Create a local env file:

```bash
cp apps/web/.env.example apps/web/.env
```

Minimum required variables:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CONVEX_SITE_URL=
YOKAI_ENCRYPTION_KEY=
```

Additional variables used by the app:

```dotenv
YOKAI_ALLOWED_ORIGINS=
AI_GATEWAY_API_KEY=
VERCEL_OIDC_TOKEN=
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
```

Notes:

- `YOKAI_ENCRYPTION_KEY` is mandatory. Without it, Yokai cannot decrypt encrypted dashboard secrets from Convex.
- `YOKAI_ALLOWED_ORIGINS` controls the allowed origins for Next.js Server Actions.
- `CRON_SECRET` protects the internal rollover endpoint for external schedulers such as `cron-job.org`.
- `AI_GATEWAY_API_KEY`, `VERCEL_ACCESS_TOKEN`, `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID` can be prefilled from env or later managed from the dashboard.
- `VERCEL_OIDC_TOKEN` is only available from env and is forwarded into the sandbox when present.

## Local Development

Install dependencies from the repo root:

```bash
bun install
```

Sync the Convex schema and functions to your development deployment:

```bash
bun run convex:sync:dev
```

Deploy Convex explicitly to dev or prod using the targets stored in `apps/web/.env`:

```bash
bun run convex:deploy:dev
bun run convex:deploy:prod
```

Start the web app:

```bash
bun run dev
```

Open `http://localhost:3000/login`.

If the project has no admin credentials yet, Yokai switches the login screen into bootstrap mode and lets you create the first admin user. After that, the dashboard and `/api/overview` require an authenticated admin session.

## Scripts

From the repo root:

```bash
bun run dev
bun run build
bun run typecheck
bun run lint
bun run check
bun run format
```

Convex workflows:

```bash
bun run convex:dev
bun run convex:sync:dev
bun run convex:deploy:dev
bun run convex:deploy:prod
bun run convex:logs:dev
bun run convex:logs:prod
bun run convex:migrate:snapshots:dev
bun run convex:migrate:snapshots:prod
```

External scheduler:

```text
GET /api/internal/sandbox-rollover
Authorization: Bearer <CRON_SECRET>
```

## Dashboard Behavior

- the dashboard auto-refreshes live data every 15 seconds through the authenticated `/api/overview` endpoint
- `Start sandbox` creates a new Vercel Sandbox, installs OpenClaw, writes `openclaw.json`, and launches the gateway on port `18789`
- when auto-recreate is enabled, Yokai snapshots the active sandbox shortly before TTL expiry, stores the latest `snapshotId` in Convex `snapshots`, and boots the replacement sandbox from that snapshot
- `/api/internal/sandbox-rollover` is intended to be called by an external scheduler like `cron-job.org`; it requires `Authorization: Bearer <CRON_SECRET>` in production
- `Sync` fetches OpenClaw session data and appends runtime usage snapshots
- recent command stdout/stderr is stored in Convex after secret redaction

## Persistence Model

Convex stores three main data areas:

- `states`: the persisted dashboard payload, including sandbox status, settings, sessions, commands, and usage snapshots
- `snapshots`: the latest persisted sandbox snapshot metadata used to restore memory across sandbox recreation
- `credentials`: admin login and password hash metadata
- `sessions`: active admin sessions used for cookie validation

Sensitive settings such as bot tokens, gateway keys, and Vercel API tokens are encrypted before they are written to Convex.
