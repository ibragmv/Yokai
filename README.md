# Yokai

Administrative console for running OpenClaw inside Vercel Sandbox with a Next.js App Router control room.

## Stack

- Next.js 16 App Router
- React 19
- Convex
- Vercel Sandbox
- Convex-backed control-plane state and admin sessions
- Login-protected admin panel

## Development

```bash
bun run dev
```

The root script delegates to the web app, where `bunx convex dev` pushes backend changes and launches the Next.js dev server in one command.
