# Nanime

Nanime is a self-hosted anime library and streaming PWA. It scans local media,
tracks playback, serves subtitles and audio tracks, and uses ffmpeg for HLS
playback and transcoding. Metadata comes from Jikan, AniList, and TVmaze.
AniList account sync and qBittorrent download management are optional.

![Nanime library](docs/library.png)

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

## Verify

```sh
bun test
bun run check
bun run build
```

See [`SECURITY.md`](SECURITY.md) to report a vulnerability.
