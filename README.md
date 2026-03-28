# Yokai

Administrative console for running OpenClaw inside Vercel Sandbox with a Next.js App Router control room.

## Stack

- Next.js 16 App Router
- React 19
- Vercel Sandbox
- Local file-backed state in `apps/web/.data`

## Development

```bash
bun run dev
```

The root script delegates directly to the Next.js app so the terminal output stays focused on a single dev server instead of Turbo task noise.
