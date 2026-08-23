# Nanime

Nanime is a self-hosted anime library and streaming PWA. It scans local media,
tracks playback, serves subtitles and audio tracks, and uses ffmpeg for HLS
playback and transcoding. Metadata comes from Jikan, AniList, and TVmaze.
AniList account sync and qBittorrent download management are optional.

![Nanime library](docs/library.png)

## Setup

See the [setup guide](setup.md) to install, configure, and run Nanime.

## Verify

```sh
bun test
bun run check
bun run build
```

See [`SECURITY.md`](SECURITY.md) to report a vulnerability.
