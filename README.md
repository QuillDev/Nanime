# Nanime

Nanime is a self-hosted anime library and streaming app. It scans local media,
organizes shows and seasons, remembers playback progress, supports subtitles,
and transcodes unsupported formats through ffmpeg.

![Nanime library with shows and playback progress](docs/library.png)

Optional integrations add AniList metadata, list syncing, and qBittorrent
download management.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- `ffmpeg` and `ffprobe` on `PATH`
- A local media directory

## Setup

```sh
bun install
cp .env.example .env
```

Set `MEDIA_DIR`, `NANIME_DATABASE`, and a random
`NANIME_ADMIN_SETUP_TOKEN` in `.env`. Nanime does not load this file itself, so
export it before starting:

```sh
set -a; . ./.env; set +a
bun run start
```

Open the configured origin and activate the `admin` account with the setup
token and a password of at least 15 characters. Remove the setup token from the
runtime environment after activation. Additional users can be provisioned from
the admin dashboard.

For local development over plain HTTP, use these values and run `bun run start`
and `bun run dev` in separate terminals:

```dotenv
NANIME_PUBLIC_ORIGIN=http://localhost:5173
NANIME_SECURE_COOKIES=false
NANIME_TRUST_PROXY=false
```

## Deployment

Nanime binds to `127.0.0.1` by default. For public access, place it behind a TLS
reverse proxy, set `NANIME_PUBLIC_ORIGIN` to the exact HTTPS origin, and leave
secure cookies enabled. Enable `NANIME_TRUST_PROXY` only when Nanime is reachable
exclusively through that proxy.

Treat the SQLite database as sensitive, keep qBittorrent private and
authenticated, and run Nanime as an unprivileged user. Grant write access to the
media directory only if admin deletion and download features need it.

All settings, including AniList OAuth, qBittorrent, and hardware transcoding,
are documented in [`.env.example`](.env.example). AniList's redirect URL must be
the public origin followed by `/api/auth/anilist/callback`; keep its persistent
token-encryption key outside the repository and backed up separately.

## Development

```sh
bun run check
bun run build
```

See [`SECURITY.md`](SECURITY.md) for the security model and vulnerability
reporting instructions.
