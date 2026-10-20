# Nanime agent guide

Nanime is a self-hosted, local-first anime library and streaming PWA for desktop
and mobile browsers. Bun/Elysia serves a React/Vite client, local media, and
SQLite state. The browser client and installed PWA support resumable offline
episode downloads through IndexedDB and a service worker. Optional integrations
include AniList and qBittorrent. AniList is the only metadata source.

## Project invariants

- This repository is private. Machine-specific deployment paths and service names
  belong in `DEPLOYMENT.md`. Never commit secrets, databases, media, environment
  contents, or library details. Keep application defaults and test fixtures
  portable and fictitious. Do not expose credentials or private user data from
  local `.env`, SQLite, cache, or media files in logs or screenshots.
- Use the Bun version pinned by `packageManager` and CI for the runtime, package
  manager, scripts, and `bun:test`. Keep those pins aligned when upgrading Bun;
  do not introduce another package manager or test framework.
- `ffmpeg` and `ffprobe` remain external executables discovered on `PATH`.
  Production code must not depend on a machine-specific executable location.
- Treat `dist/` as generated output and never edit or commit it. Edit PWA assets
  and service-worker sources in `public/`; `bun run build` produces `dist/`.
- Keep the server loopback-bound by default. Public deployments require a TLS
  reverse proxy, an exact `NANIME_PUBLIC_ORIGIN`, secure cookies, and explicitly
  trusted proxy handling.

## Architecture and state

- Fetch server data through TanStack Query hooks in `src/hooks/`, not React
  effects. Keep query keys, invalidation, and offline fallbacks coherent, and
  preserve Eden's end-to-end route types.
- SQLite is the canonical server-side state. Put schema creation and compatible
  migrations in `server/database.ts`; existing installations must survive a
  normal process restart and upgrade without losing user state.
- The exception is metadata matches: each library folder's `nanime.json`
  (`server/folderMetadata.ts`) says which AniList entry it is, so matches
  travel with the folder. SQLite only caches the fetched payloads
  (`metadata_cache`). Never key matches by folder name in the database again.
- Route playback mutations through the centralized playback mutation/audit path.
  Playback audit entries are immutable and retain actor, origin, previous state,
  next state, session duration, AniList target, and reversion relationships.
  Never repair watched state by bypassing or rewriting that history.
- Upload and mapping changes belong in the immutable library activity log.
  State changes and their activity entries must commit atomically when they are
  part of the same operation.
- Manual watched/unwatched state must remain durable. Removing an item from the
  home screen only changes its dismissal state and must not erase progress.
  Season/series operations must use the same per-episode mutation semantics, and
  AniList progress/completion updates must remain consistent with local state.
- Continue Watching exposes at most one current episode per series and advances
  completed episodes to the next unwatched episode. Fully watched shows belong
  in the separate Watched section. Finishing a mapped series should retain the
  AniList score prompt for connected accounts that do not already have a score.
- Offline media lives in browser IndexedDB and is served through `public/sw.js`,
  `public/swCore.js`, and `public/swStorage.js`. Preserve resumable chunk
  downloads, exact byte-range responses, missing-chunk repair, per-user offline
  identity, queued playback synchronization, and playback without a network.
  Do not make completed downloads visible until their full chunk inventory is
  present. Keep the shared eight-request pool global so simultaneous episode
  downloads divide available request slots instead of multiplying concurrency
  per episode.
- Keep admin-only library operations—uploads, mappings, torrents, transcodes,
  track pruning, deletion, offline artifact preparation, and user provisioning—
  behind the existing authorization boundary.

## Playback

- Preserve both direct HTTP range playback and managed HLS playback. Seeking,
  selected audio, resume offsets, manifest retries, lease ownership, capacity
  release, episode traversal, and cleanup are correctness-sensitive behavior.
- Keep HLS segment production demand-driven and bounded by the configured worker
  capacity. A stopped, replaced, or abandoned player must release its lease and
  processes without disrupting another player's session.
- Timeline scrubbing must retain pointer capture and keep controls visible for
  the entire drag, including vertical movement. Trickplay previews should use
  cached sheets with the frame endpoint as a fallback and must not block normal
  playback.
- Playback diagnostics are opt-in. New diagnostics must be useful when copied,
  avoid private data beyond the selected media path already shown to the user,
  and stay out of the normal viewing experience when disabled.

## Client and design

- Use Tailwind CSS v4 and the existing shadcn/ui patterns. Surfaces are solid
  black with the `#ec4899` accent; amber (`warning`) marks video that needs a
  transcode. Panels and menus stay opaque; scrims are only for legibility over
  artwork (hero banners, episode thumbnails). Headings use Bricolage Grotesque
  (`font-display`), everything else Geist.
- Review UI states with the design preview, not a live server: `bun run dev`
  serves `/preview/?state=loading|needs|partial|transcoding|ready` (show page) and
  `?state=home-watching|home-fresh` (library home), the real pages
  rendered from fictional fixtures in `src/preview/` with API calls stubbed.
  Add a state there when a new UI state needs review; it is not part of the
  production build. `server/capturePreviewSnapshot.ts` swaps the fictional
  fixtures for a real show's stored metadata and frames in the gitignored
  `src/preview/snapshot/`; never commit that directory.
- Preserve route-level lazy loading and avoid pulling admin, profile, player, or
  HLS-only code into the initial library bundle without a concrete reason.
- Prefer accessible native semantics, keyboard operation, visible focus, and
  existing three-dot action-menu patterns. Avoid adding one-off context-menu
  behavior for actions that fit those menus.

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

## Code quality

- Cyclomatic complexity is an error above 15 across the codebase. Extract
  cohesive helpers instead of suppressing the rule or translating branches into
  harder-to-read expressions.
- Oxlint, React Doctor, and the anti-slop plugin are required gates. Fix root
  causes; do not weaken rules, add blanket suppressions, or generate abstraction
  layers that obscure straightforward domain behavior.
- Keep browser-only code out of server modules and Node/Bun-only code out of the
  client. Shared contracts and pure playback rules belong in `shared/` when both
  sides genuinely consume them.
- Preserve unrelated working-tree changes. Do not edit generated output, local
  operator data, or broad files mechanically when a focused change is enough.

## Commits and pushing

When requested work is ready, commit the relevant changes and push them to the
project's GitHub remote after the required checks pass. The user has authorized
these pushes; do not ask again or leave completed commits local-only. Preserve
unrelated working-tree changes and never force-push shared branches. If a push
fails, resolve it when possible and explicitly report any remaining blocker.

## Verification

For deployment, follow [DEPLOYMENT.md](DEPLOYMENT.md). It records this machine's
service, pinned runtime, verification steps, backups, restart, health checks, and
rollback. The current systemd runtime override is temporary and disappears on
reboot; verify the running executable rather than assuming the shell's Bun is used.

Run `bun run check` before every commit. It must have no TypeScript or Oxlint
findings and React Doctor must score 100/100. Run relevant targeted `bun test`
suites for behavior changes and `bun run build` before release. Tests must be
deterministic, use isolated temporary state, and never depend on an operator's
library, database, network services, or credentials.

Common commands: `bun install`, `bun run dev`, `bun run start`, `bun run check`,
`bun test`, and `bun run build`.

No frontend tests: nothing under `src/`, `public/` or `preview/` gets a test,
and no browser or UI-driven suites. Cover behavior with `bun test` in
`server/` and `shared/`, through real routes and real state where possible.
Test-only helpers live in `server/test*.ts` (`testProcess.ts`, `testFetch.ts`,
`testMedia.ts`, `testSource.ts`, `libraryFilesTestServer.ts`); reuse them before adding more.

Every download (torrent or direct link) goes through `/api/downloads`
(`server/downloads.ts`): torrents are handed to qBittorrent
(`torrentDownloads.ts`), direct links and HLS streams are fetched by Nanime
(`fileDownloads.ts`) into `.nanime-downloads/` and hard-linked into the show
folder when complete. New sources produce download items; they don't add new
download paths.

Source plugins are Mangayomi JavaScript extensions (`/api/sources`,
`server/sources.ts`). Admins add a repository index link, install anime JS
sources from it, search them and queue episodes from the Find page. Each call
runs in a fresh QuickJS sandbox (`sourceRuntime.ts`) with Mangayomi's bridge
API (`sourcePrelude.ts`: Client, Document/Element, SharedPreferences, crypto and
unpack helpers) and no file, process or private-network access
(`sourceHttp.ts` refuses loopback/private hosts; tests set
`NANIME_SOURCE_ALLOW_PRIVATE_NETWORK=1`). A queued episode is resolved by its
plugin when it starts, since video links expire: a magnet goes to qBittorrent,
anything else downloads like a direct link, with subtitle tracks saved as
`<episode>.<lang>.srt`. Mangayomi's video host extractors (sibnet, VOE,
StreamWish, Filemoon, Mp4upload, ...) are JavaScript ports in
`sourceExtractors.ts`; the Quark/UC drives and GogoCDN answer no videos.
Plugins that need Mangayomi's in-app WebView aren't supported. Route tests use the fictional
repository in `server/testSourcePlugins.ts`.
