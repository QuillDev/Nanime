# AGENTS.md — Nanime

Nanime is a self-hosted anime library and streaming application. A Bun backend
serves a React/Vite SPA, streams local media, persists state in SQLite, and can
optionally integrate with qBittorrent, AniList, and TVmaze.

## Public repository hygiene

This repository is public. Never commit credentials, database files, media,
private URLs or IP addresses, hostnames, usernames, home-directory paths,
deployment-specific service names, or details about an operator's library.
Keep private deployment configuration outside the repository and document only
portable examples here. Any example values must be obviously fictitious.

## Stack and conventions

- Runtime and package manager: Bun.
- Frontend: React 19, Vite 7, and TypeScript.
- Styling: Tailwind CSS v4 and shadcn/ui. Use solid black surfaces with the pink
  `#ec4899` accent. Never add translucent surfaces or overlays.
- Fetch data through TanStack Query hooks under `src/hooks/`; do not fetch from
  React effects.
- Backend: Bun built-ins plus `ffmpeg` and `ffprobe` on `PATH`.
- The server binds to loopback by default. Public deployments belong behind a
  TLS reverse proxy with `NANIME_PUBLIC_ORIGIN` configured.

## Security invariants

- Authentication cookies stay `HttpOnly`, `SameSite=Strict`, and `Secure` by
  default.
- Mutating requests must pass same-origin validation.
- Only administrators may provision users, alter mappings, manage torrents, or
  delete media.
- Account activation requires a single-use high-entropy setup code. There is no
  public registration.
- Resolve and validate canonical media paths before reading files.
- Keep request-size limits, login throttling, generic authentication errors,
  security headers, and SQLite file permissions intact.
- Never add a network-service URL or filesystem path as an operator-specific
  default. Use environment variables and safe local defaults.

## Quality gate

Run `bun run check` before every commit. It must complete with zero TypeScript or
oxlint findings and React Doctor must report `Score: 100 / 100` with zero issues.
Do not suppress findings or weaken configuration to make the gate pass. Then run
`bun run build` before a release.

## Commands

- `bun install` — install dependencies.
- `bun run dev` — start Vite; run `bun run start` in another terminal.
- `bun run start` — start the Bun backend.
- `bun run check` — run typecheck, strict lint, and React Doctor.
- `bun run build` — typecheck and create the production bundle in `dist/`.

See `.env.example`, `README.md`, and `SECURITY.md` for portable deployment and
security guidance.
