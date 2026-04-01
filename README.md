# Yokai

Yokai is a private control room for running OpenClaw inside Vercel Sandbox. The UI is built with Next.js App Router, while Convex stores admin credentials, dashboard state, session data, command history, usage snapshots, and snapshot metadata.

## What It Does

- boot, stop, and sync an OpenClaw sandbox
- configure Telegram access, gateway credentials, default model, timeout, and Vercel project metadata
- auto-roll a sandbox before its TTL expires and restore it from the latest persisted snapshot when a dashboard or scheduler request triggers lifecycle reconciliation
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
CRON_SECRET=
AI_GATEWAY_API_KEY=
VERCEL_OIDC_TOKEN=
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
```

Optional Convex target variables used by the deploy and log scripts:

```dotenv
CONVEX_DEPLOYMENT_DEV=
NEXT_PUBLIC_CONVEX_URL_DEV=
NEXT_PUBLIC_CONVEX_SITE_URL_DEV=
CONVEX_DEPLOYMENT_PROD=
NEXT_PUBLIC_CONVEX_URL_PROD=
NEXT_PUBLIC_CONVEX_SITE_URL_PROD=
```

Notes:

- `YOKAI_ENCRYPTION_KEY` is mandatory. Without it, Yokai cannot decrypt encrypted dashboard secrets from Convex.
- `YOKAI_ALLOWED_ORIGINS` controls the allowed origins for Next.js Server Actions.
- `CRON_SECRET` protects the internal rollover endpoint for external schedulers such as `cron-job.org`. In local development, the rollover route is allowed without it when `NODE_ENV` is not `production`.
- `autoRecreateSandbox` is not a background daemon by itself. Without an open dashboard or an external scheduler hitting the rollover endpoint, an expired sandbox stays down until the next request triggers reconciliation.
- `AI_GATEWAY_API_KEY`, `VERCEL_ACCESS_TOKEN`, `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID` can be prefilled from env or later managed from the dashboard.
- `VERCEL_OIDC_TOKEN` is only available from env and is forwarded into the sandbox when present.
- the `CONVEX_*_DEV` and `CONVEX_*_PROD` variables are only needed for the explicit `convex:deploy:*` and `convex:logs:*` helper scripts.

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
```

External scheduler:

```text
GET /api/internal/sandbox-rollover
Authorization: Bearer <CRON_SECRET>
```

Use an external scheduler if you want sandbox rollover and recovery to continue while nobody is visiting the dashboard. Without it, lifecycle reconciliation only runs on normal app requests.

## Dashboard Behavior

- the dashboard auto-refreshes live data every 15 seconds through the authenticated `/api/overview` endpoint
- `Start sandbox` creates a new Vercel Sandbox, installs OpenClaw, writes `openclaw.json`, and launches the gateway on port `18789`
- when auto-recreate is enabled, Yokai attempts lifecycle reconciliation during dashboard page loads, `/api/overview` refreshes, and `/api/internal/sandbox-rollover` calls
- during that reconciliation, Yokai snapshots the active sandbox shortly before TTL expiry, stores the latest `snapshotId` plus a Convex-backed handoff bundle, and restores the replacement sandbox only from the Convex backup
- if a sandbox has already stopped or expired, auto-recreate can also recover it on the next reconciliation request
- if you manually stop the sandbox while auto-recreate remains enabled, the next reconciliation request can start it again
- if nobody opens the dashboard and no external scheduler pings `/api/internal/sandbox-rollover`, an expired sandbox remains stopped until the next request
- `/api/internal/sandbox-rollover` is intended to be called by an external scheduler like `cron-job.org`; it requires `Authorization: Bearer <CRON_SECRET>` in production
- `Sync` fetches OpenClaw session data and appends runtime usage snapshots
- recent command stdout/stderr is stored in Convex after secret redaction

## Persistence Model

Convex stores three main data areas:

- `states`: the persisted dashboard payload, including sandbox status, settings, sessions, commands, and usage snapshots
- `snapshots`: the latest persisted sandbox snapshot metadata plus Convex storage references for the handoff bundle and exported session payload used during restore
- `credentials`: admin login and password hash metadata
- `sessions`: active admin sessions used for cookie validation

Sensitive settings such as bot tokens, gateway keys, and Vercel API tokens are encrypted before they are written to Convex.

Snapshot recovery uses the Convex handoff bundle as the only restore source.
The stored Convex snapshot record is preserved even if the matching remote Vercel snapshot disappears or is deleted.
