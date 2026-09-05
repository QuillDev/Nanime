# Deploy Nanime on this machine

This is the deployment runbook for the private repository. Machine paths below
were verified on 2026-09-05. Keep credentials, environment-file contents, database
backups, and media out of Git even while the repository is private.

## 1. Identify what will be deployed

```bash
cd /home/quill/Projects/nakohako-media
git status --short
git log -1 --oneline
systemctl is-active mediaserver.service
systemctl show mediaserver.service \
  -p WorkingDirectory -p ExecStart -p DropInPaths -p EnvironmentFiles
```

The system service is `mediaserver.service`, running as `quill`. It executes
`server/app.ts` from this checkout and serves this checkout's generated `dist/`.
Restarting it deploys the current working files, including uncommitted edits.

Record the intended commit and any intentionally deployed uncommitted changes.
Before editing source or updating Git, preserve the running release's revision
and any uncommitted source in a private recovery archive. If source has already
changed since the last restart, use the last deployment record/archive to identify
the running release; the current Git revision alone does not prove what is running.
Preserve other local edits. Do not run `git reset --hard`, `git clean`, or a blind
pull in this checkout. For a clean checkout, `git pull --ff-only` is appropriate
when updating to upstream is part of the task. Otherwise verify changes in an
isolated worktree and resolve the intended release contents before deployment.

A deployment request authorizes the build and service restart; do not ask for
that permission again. A request to commit documentation alone does not require
a production restart.

## 2. Select the pinned runtime and tools

Use the Bun version in `package.json` and `.github/workflows/ci.yml`. The verified
pin is **1.4.0**. The shell's default Bun has previously been older than the pin.

```bash
export NANIME_DEPLOY_BUN=/home/quill/.local/share/nanime-runtime/1.4.0/bun
export PATH="$(dirname "$NANIME_DEPLOY_BUN"):$PATH"
bun --version
bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).packageManager)'
```

Both versions must agree before proceeding. If the project pin changes, install
the matching runtime at a durable path and update the service as well as the
build environment. On NixOS, use a Nix-compatible binary; a downloaded Linux
binary may require a loader that the machine does not provide. Do not point the
service at a binary under `/tmp`.

For player verification, these installed tool paths were verified:

```bash
export PATH="/nix/store/jfnnrn72slgs4ryx4g09lb97r193xddp-ffmpeg-8.1.1-bin/bin:/nix/store/4fa0i91br311imiyli0v1j1i3nnss3ly-chromium-150.0.7871.46/bin:$PATH"
command -v ffmpeg
command -v ffprobe
command -v chromium
```

Nix store paths can change after system updates or garbage collection. If a path
is missing, find the current installed package or provision it through the
machine's package configuration. Production code must continue discovering
`ffmpeg` and `ffprobe` through `PATH`.

## 3. Verify the release before stopping production

Install dependencies with `bun ci` when the lockfile or installed dependencies
changed. Do not use another package manager.

```bash
bun run check
```

TypeScript and Oxlint must have no findings, and React Doctor must score 100/100.
Run relevant unit suites. For the full suite, use an isolated database:

```bash
NANIME_TEST_DIR="$(mktemp -d /tmp/nanime-deploy-tests.XXXXXX)"
NANIME_DATABASE="$NANIME_TEST_DIR/test.sqlite" \
NANIME_ADMIN_SETUP_TOKEN=nanime-isolated-test-token-with-thirty-two-characters \
bun test
```

That setup token is a test fixture, never a production credential. Do not use the
production database, media, or credentials as test fixtures.

For player UI, playback hooks, HLS, media routing, or direct-streaming changes,
run `bun run test:player` immediately before committing/pushing. It builds the
client and exercises generated media against an isolated server/database. It
also replaces `dist/` in its working directory: run it in an isolated worktree
when production is serving this checkout, then build the approved release in
step 5. Documentation-only changes do not need this browser suite.

If automatic browser startup hangs on the desktop keyring, start Chrome
explicitly and connect the harness to its **WebSocket** debugger URL:

```bash
NANIME_CHROME_PROFILE="$(mktemp -d /tmp/nanime-deploy-chrome.XXXXXX)"
chromium --headless --no-sandbox --disable-gpu --no-proxy-server \
  --password-store=basic --use-mock-keychain \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=19331 \
  --user-data-dir="$NANIME_CHROME_PROFILE" \
  --autoplay-policy=no-user-gesture-required about:blank \
  > "$NANIME_CHROME_PROFILE/browser.log" 2>&1 &
NANIME_CHROME_PID=$!
```

Use an unused port, and wait until its `/json/version` endpoint responds. Then:

```bash
export NANIME_CHROME_URL="$(curl --fail --silent http://127.0.0.1:19331/json/version | bun -e 'console.log((await Bun.stdin.json()).webSocketDebuggerUrl)')"
bun run test:player
kill "$NANIME_CHROME_PID"
unset NANIME_CHROME_URL
```

Close only the browser process started for this test. Keep failure screenshots
and harness logs when diagnosing a failure. Do not bypass a failed gate.

## 4. Record recovery information and back up state

Before stopping the service, record its current revision, Bun executable, unit
and drop-in configuration in a private deployment note. Identify the effective
`NANIME_DATABASE` and exact `NANIME_PUBLIC_ORIGIN` from local configuration. A
service environment can differ from the interactive shell or `.env`.

Do not dump `systemctl show -p Environment`, `.env`, or `/proc/*/environ` into chat
or CI logs. Inspect required values locally and set these shell variables:

```bash
# Set actual values locally; do not run with placeholders.
NANIME_DEPLOY_DATABASE=/absolute/path/to/the/actual/database.sqlite
NANIME_DEPLOY_ORIGIN=https://your-actual-host.example
NANIME_DEPLOY_BACKUP="$HOME/.local/state/nanime/deployments/$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$NANIME_DEPLOY_BACKUP"
git rev-parse HEAD > "$NANIME_DEPLOY_BACKUP/checkout-commit"
git diff --binary HEAD > "$NANIME_DEPLOY_BACKUP/working-changes.patch"
```

The patch does not include untracked files: privately preserve any untracked
source files that belong to the running release too. Preserve the previous
`dist/`, lockfile, and any service configuration you are about to change. Keep
backups outside the repository, and preserve their ownership and permissions.
Include the actual previous deployment record/archive from step 1; a snapshot
of newly edited source is not a rollback copy of the old release.

Stop the service before copying its database. Confirm no other process is using
that database, and keep its WAL alongside it if one remains:

```bash
sudo -n systemctl stop mediaserver.service
systemctl is-active mediaserver.service
# Expected: inactive. If it remains active, do not continue.
cp -a dist "$NANIME_DEPLOY_BACKUP/dist"
cp -a "$NANIME_DEPLOY_DATABASE" "$NANIME_DEPLOY_BACKUP/database.sqlite"
for suffix in -wal -shm; do
  if test -f "$NANIME_DEPLOY_DATABASE$suffix"; then
    cp -a "$NANIME_DEPLOY_DATABASE$suffix" "$NANIME_DEPLOY_BACKUP/database.sqlite$suffix"
  fi
done
```

Use an account that can read the database; do not loosen database permissions.
If downtime is unsuitable, use the [SQLite online backup API](https://www.sqlite.org/backup.html)
instead of copying a live database file. An online backup is a snapshot, so
account for writes made afterward when planning rollback.

## 5. Build and check the service runtime

From the approved deployment checkout, with the pinned Bun on `PATH`:

```bash
bun run build
```

Stop on failure and restore the previous release. Never edit or commit `dist/`.
Building while production is running would replace client assets before the
backend restart; the preceding stop avoids that version mismatch.

The current service uses this **runtime-only** drop-in:

`/run/systemd/system/mediaserver.service.d/90-bun-runtime.conf`

```ini
[Service]
ExecStart=
ExecStart=/home/quill/.local/share/nanime-runtime/1.4.0/bun run /home/quill/Projects/nakohako-media/server/app.ts
```

It survives service restarts but **disappears on reboot**. The base unit is
Nix-managed, so editing `/etc/systemd/system/mediaserver.service` directly is not
the durable fix. Put the pinned runtime in the machine's NixOS service
configuration for reboot persistence; the location of that configuration is not
recorded in this repository. Do not claim the override is permanent until that
configuration has been applied and verified.

If the runtime override is missing or incorrect and restoring it is needed for
this deployment, recreate it using the verified pinned runtime:

```bash
sudo -n install -d -m 755 /run/systemd/system/mediaserver.service.d
sudo -n tee /run/systemd/system/mediaserver.service.d/90-bun-runtime.conf >/dev/null <<'UNIT'
[Service]
ExecStart=
ExecStart=/home/quill/.local/share/nanime-runtime/1.4.0/bun run /home/quill/Projects/nakohako-media/server/app.ts
UNIT
sudo -n systemctl daemon-reload
```

`daemon-reload` is needed after changing unit configuration, not for ordinary
source changes. Keep the existing service user, environment, proxy configuration,
and filesystem permissions.

## 6. Restart and verify what is actually running

```bash
sudo -n systemctl restart mediaserver.service
systemctl is-active mediaserver.service
NANIME_DEPLOY_PID="$(systemctl show mediaserver.service -p MainPID --value)"
NANIME_RUNNING_BUN="$(sudo -n readlink "/proc/$NANIME_DEPLOY_PID/exe")"
"$NANIME_RUNNING_BUN" --version
```

Expect `active` and the pinned Bun version. A process can fail just after systemd
starts it, so continue with the HTTP checks. If `/proc` is briefly unavailable,
re-read `MainPID` after a short retry. Review service logs privately on failure;
redact account names, media paths, addresses, and credentials before sharing.

Check the actual public HTTPS origin and compare the returned HTML with the
built release:

```bash
curl --fail --silent --show-error \
  --output "$NANIME_DEPLOY_BACKUP/served-index.html" "$NANIME_DEPLOY_ORIGIN/"
cmp dist/index.html "$NANIME_DEPLOY_BACKUP/served-index.html"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "$NANIME_DEPLOY_ORIGIN/api/auth/me"
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  "$NANIME_DEPLOY_ORIGIN/api/progress/history"
```

Expect matching HTML, HTTP 200 from `/api/auth/me` (an anonymous request returns
JSON `null`), and HTTP 401 from `/api/progress/history`. Then check
the changed feature with existing authorized test accounts. Do not create users
or change production watch history just to obtain a health signal.

For playback releases, confirm direct and HLS playback, seeking, and cleanup.
For party releases, confirm joining, shared episode changes, refresh, and host
handoff. Ask testers to refresh to load the new client bundle; account for any
installed PWA update waiting to activate.

Keep loopback binding, the exact public origin, secure cookies, TLS proxy, and
trusted-proxy handling intact. Do not expose a new port as a deployment shortcut.

## 7. Roll back a failed release

1. Stop `mediaserver.service` and preserve failure logs and the post-deployment
   database privately for diagnosis.
2. Restore the recorded previous source and lockfile without discarding unrelated
   working edits. Reinstall matching dependencies and restore the previous `dist/`;
   alternatively rebuild that source with its matching Bun version.
3. Review `server/database.ts` migrations before deciding whether the older code
   can use the current database. Do not automatically restore a database backup:
   that would discard account, playback, and party changes made since the backup.
4. If database restoration is necessary, keep the service stopped, obtain approval
   for any loss of newer user state, and preserve the newer database first. Restore
   the backed-up database and its corresponding WAL/SHM files together, with the
   original owner and restrictive permissions. Never pair an old database with
   sidecars from the failed release.
5. Restore the previous runtime/unit settings if changed, run `daemon-reload` when
   needed, restart the service, and repeat step 6.

Finish by reporting the deployed revision, tests performed, health-check result,
and any remaining temporary runtime configuration. A Git push or successful build
alone is not a verified deployment.
