# Nanime agent guide

Nanime is a self-hosted anime library and streaming PWA. Bun/Elysia serves a
React/Vite client, local media, and SQLite state. Optional integrations include
AniList and qBittorrent; metadata also uses Jikan and TVmaze.

## Rules

- This is a public repository. Never commit secrets, databases, media, private
  addresses, operator paths, deployment names, or library details. Examples must
  be portable and obviously fictitious.
- Use Bun for the runtime and package manager. `ffmpeg` and `ffprobe` must remain
  external executables found on `PATH`.
- Fetch client data through TanStack Query hooks in `src/hooks/`, not React
  effects. Preserve Eden's end-to-end route types.
- Use Tailwind CSS v4 and the existing shadcn/ui patterns. Surfaces are solid
  black with the `#ec4899` accent; do not add translucent UI.
- Keep the server loopback-bound by default. Public deployments require a TLS
  reverse proxy and an exact `NANIME_PUBLIC_ORIGIN`.

## Client capabilities

Do not infer mobile or desktop from width, user agent, or PWA display mode.

- Width breakpoints are for available-space layout and typography only.
- Use `(hover: hover) and (pointer: fine)` for mouse/trackpad presentation and
  `(hover: none) and (pointer: coarse)` for touch-first presentation.
- For an interaction, prefer the event's `pointerType`.
- Use `display-mode` only for PWA shell behavior. Handle safe-area insets
  independently on every client.

Landscape phones can cross desktop width breakpoints. In the player, subtitle
typography may scale with width, but desktop control clearance must depend on
hover and pointer capability.

## Security

- Preserve `HttpOnly`, `SameSite=Strict`, secure-by-default cookies, same-origin
  checks, security headers, login throttling, request limits, generic auth
  errors, and restrictive SQLite permissions.
- Only admins may provision users, change mappings, manage downloads, or delete
  media. Account setup uses single-use high-entropy codes; there is no public
  registration.
- Canonicalize and validate media paths before filesystem access.
- Configuration defaults must not contain operator-specific URLs or paths.

## Verification

Run `bun run check` before every commit. It must have no TypeScript or oxlint
findings and React Doctor must score 100/100. Do not suppress findings or weaken
the checks. Run relevant `bun test` suites for behavior changes and `bun run
build` before release.

Common commands: `bun install`, `bun run dev`, `bun run start`, `bun run check`,
`bun test`, and `bun run build`.
