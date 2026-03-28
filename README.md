# Yokai

Yokai is a private control room for operating OpenClaw inside Vercel Sandbox. The app uses Next.js App Router for the admin UI and Convex as the control-plane backend for persisted state, credentials, and live operational data.

## What It Does

- boots and stops an OpenClaw sandbox
- stores dashboard state in Convex under the `states` table
- protects the control room with admin credentials and session cookies
- tracks sandbox sessions, recent commands, and gateway usage snapshots
- exposes a small authenticated overview API for live dashboard refreshes

## Stack

- Next.js 16 App Router
- React 19
- Convex
- Vercel Sandbox
- Bun workspaces
- Biome

## Project Layout

```text
.
├── apps/web
│   ├── src/app            # App Router pages, route handlers, server actions
│   ├── src/components     # Client UI
│   ├── src/lib            # Server-side dashboard, auth, gateway, sandbox logic
│   └── convex             # Schema, validators, queries, mutations
├── package.json           # Workspace scripts
└── README.md
```

## Environment

The web app uses `apps/web/.env` for local development. Commit `apps/web/.env.example`, keep `apps/web/.env` out of git.

```bash
cp apps/web/.env.example apps/web/.env
```

Convex dev scripts are configured with `--env-file .env`, so syncing the development deployment updates `apps/web/.env` instead of recreating `apps/web/.env.local`.

Required baseline variables:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CONVEX_SITE_URL=
```

Optional integrations:

```dotenv
AI_GATEWAY_API_KEY=
VERCEL_OIDC_TOKEN=
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
```

## Local Development

Install dependencies:

```bash
bun install
```

Run the Next.js app:

```bash
bun run dev
```

`bun run dev` starts only the web app. Convex sync and deployment stay explicit so schema changes are intentional.

## Convex Workflows

Sync the current schema and functions to the development deployment:

```bash
bun run convex:sync:dev
```

Deploy the current schema and functions to production:

```bash
bun run convex:deploy
```

Inspect logs when needed:

```bash
bun run convex:logs:dev
bun run convex:logs:prod
```

## Quality Checks

```bash
bun run check
bun run typecheck
```

## Notes

- the control room is built around Server Components for reads and Server Actions for mutations
- the authenticated overview endpoint exists only for client-side live refreshes
- secrets are redacted in the UI and encrypted before persisted dashboard state is written to Convex
