# Nanime

Nanime is a self-hosted anime library and streaming PWA. It scans local media,
tracks playback, serves subtitles and audio tracks, and uses ffmpeg for HLS
playback and transcoding. Metadata comes from AniList.
AniList account sync and qBittorrent download management are optional.
Admins can install [Mangayomi](https://github.com/kodjodevf/mangayomi) JavaScript
anime sources from a repository link, search them, and download whole seasons into
the library.

![Nanime library home](docs/library.jpg)

![Nanime show page](docs/show.jpg)

## Setup

See the [setup guide](setup.md) to install, configure, and run Nanime.

For updates on the hosted machine, follow the [deployment runbook](DEPLOYMENT.md).

## Watch together

Choose the people icon labeled **Party** in the navigation bar to **Create party**,
paste an invite to **Join party**, or copy your current party's invite link. You can
create and join before choosing an episode. The icon opens a small panel beside
the navigation bar, with a live member list and host-only **Remove** controls.
Click outside or press Escape to dismiss it. Removing a member disconnects that
tab from the party, including after a refresh. The player's three-dot menu also offers
**Start watch together**. Share invites with another signed-in user of the same
server. The host controls play, pause, seeking, and playback speed; guests
keep their own audio, subtitles, volume, and watch history. Guests may need to
press **Enable playback** once if their browser blocks autoplay.

The same invite link follows the host across episodes and shows. Closing the
player keeps the session open while the host browses; guests wait for the next
selection. Refreshing either browser restores that tab's party membership for the
signed-in account. **Leave session** hands hosting to the longest-connected guest;
**End session** closes the party for everyone. Unexpected host disconnects allow
30 seconds for reconnection before promoting a connected guest. Handoffs pause
playback so the new host can resume when ready. Old tabs cannot reclaim control
after a handoff. Empty, abandoned parties expire after 24 hours.

Watch together requires a network connection; offline downloads remain independent.

## Library files

Admins can organize the library from **Admin → Files**: browse the folder tree,
create folders, rename, move, and delete files or folders. Moving or renaming a
video takes its subtitle sidecars along, and watch progress, playback history,
show and season mappings, scans, and transcode records follow the media. Every
change is checked on the server against the canonical library root: paths can't
escape it, symbolic links aren't followed, and existing destinations are never
replaced. Changes are journaled for recovery after interruption. Recovery that
cannot prove ownership stops and keeps the affected paths locked instead of
claiming that a rollback succeeded.

Run only one Nanime writer process per library. Journaled filesystem mutations
require Linux/glibc, `/proc`, and a filesystem supporting `renameat2`; unsupported
platforms, volumes, and case-only renames on case-insensitive volumes fail closed.
The React file-manager package itself has no backend or platform dependency.

Private journal staging is kept in the library parent's owner-only
`.nanime-journal/<library-root-hash>` directory, **outside** the downloader's shared
media-root mount. The parent must be writable by Nanime and staging must be on
the same filesystem as the media; cross-device mutations fail rather than copying.
Do not expose that private sibling to downloader containers or other untrusted
writers. Root/directory topology and private staging remain trusted application
storage, not a defense against an uncoordinated process with full host-user access.


**Delete** moves items to `.nanime-trash/` inside the library, and **Undo** restores
them; there is no permanent purge in the app, so empty that folder manually when
you're sure. Files owned by qBittorrent torrents (downloading or seeding) are
locked, along with the folders containing them, so seeding never breaks. If
qBittorrent is configured but unreachable, renames, moves, and deletes pause until
it responds. Active transcodes, offline-copy preparation, and uploads lock their
files as well.

## Metadata outages

If metadata providers are unavailable, open **Match metadata → Link manually
(no API)** and enter a title and AniList anime ID. This saves a local mapping
without validating the ID or fetching artwork. Refresh metadata after the API
recovers to fill in missing details. AniList progress synchronization still
requires its public API.

## Agents (MCP)

`bun run mcp` is a stdio MCP server that lets an agent search the installed
source plugins, list a result's episodes and queue them through Nanime's
downloads, then watch, pause, resume or cancel them. It signs in to a running
Nanime as an admin account and uses the same routes as the web app, so adding
repositories and installing sources stays in the web app.

```yaml
# e.g. a Hermes Agent mcp_servers entry
nanime:
  command: bun
  args: [run, /path/to/nanime/server/mcp.ts]
  env:
    NANIME_URL: https://nanime.example
    NANIME_USERNAME: agent
    NANIME_PASSWORD_FILE: /path/to/password  # chmod 600
```

## Verify

```sh
bun test
bun run check
bun run build
```

See [`SECURITY.md`](SECURITY.md) to report a vulnerability.
