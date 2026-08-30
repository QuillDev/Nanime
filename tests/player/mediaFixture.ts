import { link, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const FIXTURE_FOLDER = "Browser Fixture Show";
export const COMMON_FIRST_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 01.mp4`;
export const COMMON_SECOND_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 02.mp4`;
export const WATCHED_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 03.mp4`;
export const DIRECT_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 04.mp4`;
export const HLS_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 05.mkv`;
export const HLS_FAILURE_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 06.mkv`;
export const FIXTURE_DURATION = 48;

export const FIXTURE_METADATA = {
  provider: "jikan",
  id: 1,
  anilistId: null,
  idMal: 1,
  title: { english: FIXTURE_FOLDER, romaji: FIXTURE_FOLDER, native: null },
  description: "Generated browser player test fixture",
  coverImage: { extraLarge: null, large: null, color: null },
  bannerImage: null,
  episodes: 6,
  duration: 2,
  season: null,
  seasonYear: null,
  startDate: null,
  format: "TV",
  status: "FINISHED_AIRING",
  genres: [],
  averageScore: null,
  siteUrl: "https://example.invalid/nanime-player-fixture",
  streamingEpisodes: [],
};

async function run(command: readonly string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command[0] ?? "Command"} failed (${String(exitCode)})\n${stdout}${stderr}`);
  }
}

export async function generateFixture(mediaDirectory: string, ffmpeg: string): Promise<void> {
  const folder = join(mediaDirectory, FIXTURE_FOLDER);
  const hlsFixture = join(mediaDirectory, HLS_FIXTURE);
  const directFixture = join(mediaDirectory, DIRECT_FIXTURE);
  await mkdir(folder, { recursive: true });
  await run([
    ffmpeg, "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=256x144:rate=24:duration=${String(FIXTURE_DURATION)}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${String(FIXTURE_DURATION)}`,
    "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${String(FIXTURE_DURATION)}`,
    "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p",
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "64k",
    "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=jpn",
    "-disposition:a:0", "default", "-shortest", hlsFixture,
  ]);
  await run([
    ffmpeg, "-hide_banner", "-loglevel", "error", "-i", hlsFixture,
    "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", directFixture,
  ]);
  await Promise.all([
    link(directFixture, join(mediaDirectory, COMMON_FIRST_FIXTURE)),
    link(directFixture, join(mediaDirectory, COMMON_SECOND_FIXTURE)),
    link(directFixture, join(mediaDirectory, WATCHED_FIXTURE)),
    link(hlsFixture, join(mediaDirectory, HLS_FAILURE_FIXTURE)),
  ]);
}
