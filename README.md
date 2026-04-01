# Yokai

Yokai is a private control room for running OpenClaw inside Vercel Sandbox. It gives you a locked-down admin dashboard for booting, rotating, restoring, and observing a single OpenClaw runtime, while Convex persists credentials, state, snapshots, command history, and usage data.

## Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ibragmv/Yokai&project-name=yokai&repository-name=Yokai&root-directory=apps/web&install-command=bun%20install&build-command=bun%20run%20build)

The button clones this repository into a new Vercel project with the `apps/web` app preselected. Yokai also needs a Convex deployment, so treat Vercel as the web host and Convex as the persistent state layer.

## At a Glance

- Private admin dashboard for a single OpenClaw runtime
- Convex-backed persistence for state, snapshots, sessions, and command history
- Request-driven sandbox rollover and recovery
- Production-safe secret masking and encryption at rest
- Bun-first monorepo with a clean self-hosted setup path

## Feature Highlights

| Feature | What you get |
| --- | --- |
| Sandbox control | Start, stop, and sync one OpenClaw sandbox from the dashboard |
| Recovery flow | Snapshot, handoff bundle persistence, and restore on the next reconcile |
| Secure admin access | First-run bootstrap, hashed passwords, protected routes, session cookies |
| Observability | Recent sessions, command output, usage snapshots, runtime status |
| Self-hosted setup | Local Bun workflow, Convex integration, Vercel-ready deployment path |

## Why Yokai

- Start, stop, and sync a single OpenClaw sandbox from one dashboard.
- Store the latest runtime state, snapshot metadata, command output, and session inventory in Convex.
- Auto-roll a sandbox before TTL expiry and restore from the latest Convex-backed handoff bundle.
- Lock down the UI with a bootstrap-once admin login and cookie-backed protected routes.
- Keep secrets masked in the UI and encrypted at rest before writing them to Convex.

## Stack

- Bun workspaces
- Next.js 16 App Router
- React 19
- Convex
- Vercel Sandbox
- Biome

## Architecture

```text
Browser
  -> Next.js dashboard
  -> Server Actions / API routes
  -> Convex state + storage
  -> Vercel Sandbox runtime
  -> OpenClaw gateway
```

Yokai manages one active sandbox at a time. The dashboard is the control plane. Convex is the persistence layer. OpenClaw runs inside the sandbox, not in the Next.js process.

## Screenshots

Add your own product screenshots here once your deployment is live.

```text
README assets suggestion:
- docs/screenshots/dashboard-overview.png
- docs/screenshots/dashboard-activity.png
- docs/screenshots/dashboard-settings.png
```

Suggested captions:

- Overview: runtime state, latest snapshot, and recovery window
- Activity: tracked sessions and redacted command output
- Settings: sandbox behavior, allowlists, and gateway credentials

## Project Layout

```text
.
├── apps/web
│   ├── src/app            # App Router pages, route handlers, server actions
│   ├── src/components     # Dashboard UI
│   ├── src/lib            # Auth, store, sandbox, gateway, security logic
│   ├── convex             # Convex schema, validators, queries, mutations
│   └── .env.example       # Publish-safe environment template
├── package.json           # Workspace-level scripts
└── README.md
```

## Requirements

- Bun 1.3+
- A Convex project
- A Vercel project for hosting the Next.js app
- Access to Vercel Sandbox in the target account
- Optional: an AI Gateway key if you want Gateway model discovery and credit reporting
- Optional: a scheduler for unattended sandbox rollover

## Quick Start

1. Install dependencies from the repo root.

```bash
bun install
```

2. Create your local environment file.

```bash
cp apps/web/.env.example apps/web/.env
```

3. Fill in the required values in `apps/web/.env`.

4. Sync Convex for your development target.

```bash
bun run convex:sync:dev
```

5. Start the app.

```bash
bun run dev
```

6. Open `http://localhost:3000/login` and bootstrap the first admin account.

If no credentials exist yet, Yokai switches the login screen into setup mode and creates the first admin user. After that, the dashboard and `/api/overview` require a valid authenticated session.

## Demo Flow

1. Deploy the app and connect it to a Convex project.
2. Open `/login` and create the first admin account.
3. Save runtime settings such as Telegram token, timeout, and default model.
4. Start the sandbox and wait for the OpenClaw gateway to become ready.
5. Use `Sync Sessions` to pull the latest OpenClaw session inventory.
6. Enable auto-recreate and attach a scheduler if you want unattended rollover.

## Deploy Your Own Setup

### 1. Fork or copy the repository

Create your own Git repository first. Do not deploy directly from someone else's working tree.

### 2. Create a Convex deployment

Create a Convex project and collect these values:

- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`

If you want separate explicit targets for local helper commands, also define:

- `CONVEX_DEPLOYMENT_DEV`
- `NEXT_PUBLIC_CONVEX_URL_DEV`
- `NEXT_PUBLIC_CONVEX_SITE_URL_DEV`
- `CONVEX_DEPLOYMENT_PROD`
- `NEXT_PUBLIC_CONVEX_URL_PROD`
- `NEXT_PUBLIC_CONVEX_SITE_URL_PROD`

### 3. Create a stable encryption secret

Set `YOKAI_ENCRYPTION_KEY` to a long random string and keep it stable across redeploys for the same environment. If you rotate it without migrating stored data, Yokai will not be able to decrypt existing encrypted settings.

### 4. Configure the web app environment

For production, set:

- `NEXT_PUBLIC_APP_URL`
- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`
- `YOKAI_ENCRYPTION_KEY`

Recommended production variables:

- `CRON_SECRET`
- `YOKAI_ALLOWED_ORIGINS`

Optional runtime variables:

- `AI_GATEWAY_API_KEY`
- `VERCEL_OIDC_TOKEN`

### 5. Import the repository into Vercel

Use the button above or import the repository manually in Vercel. Add the production environment variables from the previous step before the first deploy.

For the cleanest Turborepo detection in Vercel:

- keep `turbo.json` committed at the repository root
- install dependencies from the repository root with Bun
- let the project build through the root `bun run build` script

### 6. Add a scheduler if you want unattended recovery

Call:

```text
GET /api/internal/sandbox-rollover
Authorization: Bearer <CRON_SECRET>
```

Without a scheduler, auto-recreate only runs when a dashboard request or overview refresh reaches the app.

## Environment Reference

Copy `apps/web/.env.example` to `apps/web/.env` for local work.

### Required

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CONVEX_SITE_URL=
YOKAI_ENCRYPTION_KEY=
```

### Recommended

```dotenv
YOKAI_ALLOWED_ORIGINS=
CRON_SECRET=
```

### Optional

```dotenv
AI_GATEWAY_API_KEY=
VERCEL_OIDC_TOKEN=
```

### Optional helper targets

```dotenv
CONVEX_DEPLOYMENT_DEV=
NEXT_PUBLIC_CONVEX_URL_DEV=
NEXT_PUBLIC_CONVEX_SITE_URL_DEV=
CONVEX_DEPLOYMENT_PROD=
NEXT_PUBLIC_CONVEX_URL_PROD=
NEXT_PUBLIC_CONVEX_SITE_URL_PROD=
```

### Variable notes

- `YOKAI_ENCRYPTION_KEY` is mandatory for encrypted settings stored in Convex.
- `YOKAI_ALLOWED_ORIGINS` controls allowed origins for Next.js Server Actions.
- `CRON_SECRET` protects the rollover endpoint in production.
- `AI_GATEWAY_API_KEY` enables Gateway model discovery and credit snapshots and can also be supplied later from the dashboard.
- `VERCEL_OIDC_TOKEN` is env-only and is forwarded into the sandbox when present.

## Local Development

From the repo root:

```bash
bun install
bun run convex:sync:dev
bun run dev
```

Useful commands:

```bash
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

## Production Notes

- Yokai is production-ready as a single-tenant admin surface, not a multi-tenant control plane.
- Protected pages and API routes require the admin session cookie.
- Secrets are encrypted before persistence and redacted from stored command output.
- `autoRecreateSandbox` is request-driven. It is not a background daemon.
- Recovery restores from the Convex-backed handoff bundle, not from the remote Vercel snapshot itself.
- If the latest backup bundle is missing or damaged, Yokai falls back to a clean boot.

## Dashboard Behavior

- The dashboard refreshes live data every 15 seconds through the authenticated `/api/overview` endpoint.
- `Start sandbox` creates a Vercel Sandbox, installs OpenClaw, writes `openclaw.json`, and launches the gateway on port `18789`.
- `Sync Sessions` fetches OpenClaw session data and appends runtime usage snapshots.
- When auto-recreate is enabled, Yokai attempts lifecycle reconciliation during page loads, overview refreshes, and rollover endpoint calls.
- If a running sandbox reaches its rollover window, Yokai snapshots it, stores the latest handoff bundle in Convex, starts a replacement sandbox, and then stops the previous one.
- If a sandbox is already gone, Yokai can recreate it from the latest valid backup on the next reconciliation request.

## Persistence Model

Convex stores:

- `states`: dashboard settings, sandbox state, sessions, commands, usage, and operation lease
- `snapshots`: latest snapshot metadata plus the storage reference for the handoff bundle
- `credentials`: admin login and password hash metadata
- `sessions`: active admin sessions used for cookie validation

Sensitive settings such as bot tokens and gateway keys are encrypted before they are written to Convex.

## Security Notes

- The first login flow bootstraps exactly one admin credential set.
- Passwords are salted and hashed before storage.
- Session cookies are `httpOnly` and `sameSite=lax`.
- API responses are sent with `Cache-Control: private, no-store, max-age=0`.
- Security headers are configured in `next.config.ts`.

## FAQ

### Does Yokai manage multiple sandboxes?

No. The current design is intentionally single-runtime and manages one active OpenClaw sandbox at a time.

### Does auto-recreate run in the background by itself?

No. Reconciliation is request-driven. For unattended rollover, add a scheduler that calls `/api/internal/sandbox-rollover`.

### Is the Vercel button enough on its own?

No. You still need to configure Convex and the required environment variables before the deployment is actually usable.

### Are secrets stored in plain text?

No. Sensitive settings are encrypted before they are written to Convex, and command output is redacted before it is stored in the activity feed.

### Can I use Yokai without an AI Gateway key?

Yes. The dashboard still works, but Gateway model discovery and credit reporting fall back to reduced behavior.

## Self-Hosted Checklist

- Forked or copied into your own repository
- Convex deployment created
- Required environment variables set
- Stable `YOKAI_ENCRYPTION_KEY` saved
- Production URL set in `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET` set for production
- Scheduler configured if unattended rollover is required
- First admin account bootstrapped through `/login`
