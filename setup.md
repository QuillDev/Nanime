# Setup

This guide covers a standard Nanime installation. Commands assume a terminal
with Git available.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- `ffmpeg` and `ffprobe` on `PATH`
- A directory containing your media

Confirm the required programs are available:

```sh
bun --version
ffmpeg -version
ffprobe -version
```

## Install

```sh
git clone https://github.com/QuillDev/Nanime.git
cd Nanime
bun install
cp .env.example .env
```

## Configure

Open `.env` and set these values:

| Setting | Purpose |
| --- | --- |
| `MEDIA_DIR` | Absolute path to the media directory |
| `NANIME_DATABASE` | Absolute path for the SQLite database |
| `NANIME_ADMIN_SETUP_TOKEN` | Random secret used for the first admin login |
| `NANIME_PUBLIC_ORIGIN` | Exact URL used to open Nanime |

Generate the setup token with:

```sh
bun -e 'import { randomBytes } from "node:crypto"; console.log(randomBytes(32).toString("hex"))'
```

The database directory must exist and be writable by the account running
Nanime. The media directory needs read access. It also needs write access if you
use uploads, downloads, transcoding, track pruning, or media deletion.

### Local access

For access from the same machine over HTTP, use:

```dotenv
HOST=127.0.0.1
PORT=8096
NANIME_PUBLIC_ORIGIN=http://localhost:8096
NANIME_SECURE_COOKIES=false
NANIME_TRUST_PROXY=false
```

### Access through HTTPS

For access through a TLS reverse proxy, use:

```dotenv
HOST=127.0.0.1
PORT=8096
NANIME_PUBLIC_ORIGIN=https://anime.example.com
NANIME_SECURE_COOKIES=true
NANIME_TRUST_PROXY=true
```

Replace the example origin with the exact public origin. Keep Nanime bound to
loopback. Enable `NANIME_TRUST_PROXY` only when all access passes through the
proxy.

## Build and start

```sh
bun run build
bun run start
```

Bun loads `.env` automatically. Nanime serves the built web app and API from
the configured host and port.

Use a process manager to keep `bun run start` running and restart it after
updates. The process should run as an unprivileged account with access only to
the database and media paths it needs.

## Activate the admin account

Open `NANIME_PUBLIC_ORIGIN` in a browser and select **Activate a provisioned
account**. Enter `admin`, the setup token, and a new password of at least 15
characters.

After activation:

1. Remove `NANIME_ADMIN_SETUP_TOKEN` from `.env`.
2. Restart Nanime.
3. Create other accounts from the admin panel.

## Optional integrations

The remaining settings in [`.env.example`](.env.example) configure:

- AniList sign-in and list synchronization
- qBittorrent download management
- VAAPI hardware acceleration
- Background transcode concurrency

Leave an optional integration's settings empty when it is not in use. Keep all
credentials out of the repository.

## Local development

Set the local browser origin:

```dotenv
NANIME_PUBLIC_ORIGIN=http://localhost:5173
NANIME_SECURE_COOKIES=false
NANIME_TRUST_PROXY=false
```

Run the backend and frontend in separate terminals:

```sh
bun run start
```

```sh
bun run dev
```

Open `http://localhost:5173`.

## Update

For this hosted installation, follow the step-by-step [deployment runbook](DEPLOYMENT.md).
It covers the pinned runtime, verification, backups, service restart, health
checks, and rollback. Other installations should adapt the service and filesystem
paths to their own process manager while preserving those checks.
