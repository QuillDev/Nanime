# Nanime

Nanime is a compact, self-hosted anime library. It organizes folders into shows
and seasons, enriches them through AniList first and TVmaze second, streams common
video formats with an ffmpeg HLS fallback, supports embedded subtitles, remembers
per-user playback progress, and optionally manages qBittorrent downloads.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- `ffmpeg` and `ffprobe` on `PATH`
- A directory containing your media
- Optional: qBittorrent with its Web API enabled

## Quick start

```sh
bun install
cp .env.example .env
```

Edit `.env`, generate a random initial setup code, and point `MEDIA_DIR` and
`NANIME_DATABASE` at directories writable by the service user. Then:

```sh
bun run check
bun run build
set -a; . ./.env; set +a
bun run start
```

Visit the configured origin, choose **Activate a provisioned account**, enter
the username `admin`, the `NANIME_ADMIN_SETUP_TOKEN`, and a new password of at
least 15 characters. Remove the setup token from the service environment after
activation. Administrators provision additional users in the UI and receive a
different one-time setup code for each account.

For plain-HTTP local development only, set:

```dotenv
NANIME_PUBLIC_ORIGIN=http://localhost:5173
NANIME_SECURE_COOKIES=false
NANIME_TRUST_PROXY=false
```

Run `bun run start` and `bun run dev` in separate terminals.

## Production deployment

Nanime deliberately binds to `127.0.0.1` by default. Put it behind a maintained
TLS reverse proxy, set `NANIME_PUBLIC_ORIGIN` to the exact public HTTPS origin,
and enable `NANIME_TRUST_PROXY` only when requests can reach Nanime exclusively
through that trusted proxy. Keep secure cookies enabled.

Protect the SQLite database as sensitive data: it contains password hashes,
hashed session tokens, user activity, and library metadata. Back it up, restrict
filesystem access to the service account, and never place it in the web root.

Keep qBittorrent private and authenticated. Nanime only needs its Web API; do not
expose that API directly to the internet. Run Nanime as an unprivileged account
with read access to media and grant write/delete access only if those admin
features are needed.

Configuration is documented in [`.env.example`](.env.example). Nanime does not
load `.env` itself; use your process manager, container runtime, or shell to pass
the environment.

## Metadata behavior

Show and season mappings are selected through AniList. TVmaze is accepted only
when its normalized title and release year exactly match the AniList record.
Mapped metadata is stored in SQLite; TVmaze enrichment is refreshed after seven
days rather than on each page load.

## Security

There is no public registration. Passwords use Argon2id, account activation uses
single-use setup codes, sessions are represented by hashed random tokens, and
administrative operations are authorization-checked server-side. See
[`SECURITY.md`](SECURITY.md) for reporting and deployment expectations.

No security review can make an internet-facing service risk-free. Keep Bun,
ffmpeg, qBittorrent, and the reverse proxy patched, monitor authentication logs,
and limit network exposure to the users who need it.
