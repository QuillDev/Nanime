/**
 * Snapshot one real show into the design preview: stored metadata, the season's
 * episode list, a frame per episode and the banner. Output goes to the
 * gitignored `src/preview/snapshot/`; library media must never be committed.
 *
 *   bun server/capturePreviewSnapshot.ts <database.sqlite> <media-dir> <metadata-key> <season-folder>
 *   e.g. ... ~/.local/share/nanime/nanime.sqlite ~/media/anime "show:Mistress Kanan is Devilishly Easy" "[Judas] Kanan-sama ..."
 */
import { Database } from "bun:sqlite";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [databasePath, mediaDir, key, folder] = process.argv.slice(2);
if (databasePath === undefined || mediaDir === undefined || key === undefined || folder === undefined) {
  throw new Error("usage: capturePreviewSnapshot.ts <database.sqlite> <media-dir> <metadata-key> <season-folder>");
}
const seasonDir = join(mediaDir, folder);
const out = join(import.meta.dir, "..", "src", "preview", "snapshot");
const FRAME_SECONDS = 420;
const VIDEO = /\.(?:mkv|mp4|webm|m4v|mov)$/iu;
const EPISODE = /S\d+E(?<number>\d+)/iu;

const database = new Database(databasePath, { readonly: true });
const row = database.query<{ readonly payload: string }, [string]>("SELECT payload FROM media_metadata WHERE key = ?").get(key);
database.close();
if (row === null) {
  throw new Error(`No stored metadata for ${key}`);
}
interface StoredMedia {
  readonly bannerImage: string | null;
  readonly streamingEpisodes?: readonly { readonly title: string; readonly thumbnail: string | null; readonly site: string }[];
}
const media = JSON.parse(row.payload) as StoredMedia;

const listing = await readdir(seasonDir);
const names = listing.filter((name) => VIDEO.test(name)).toSorted();
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

async function frame(name: string, number: number): Promise<string> {
  const file = `ep${String(number).padStart(2, "0")}.jpg`;
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", String(FRAME_SECONDS), "-i", join(seasonDir, name),
    "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", join(out, file),
  ], { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
  if (await proc.exited !== 0) {
    throw new Error(`Could not extract a frame from ${name}`);
  }
  return file;
}

const entries = await Promise.all(names.map(async (name, index) => {
  const number = Number(EPISODE.exec(name)?.groups?.["number"] ?? index + 1);
  const { size } = await stat(join(seasonDir, name));
  return { entry: { rel: `${folder}/${name}`, name, folder, size, direct: false }, number, thumbnail: await frame(name, number) };
}));

if (media.bannerImage !== null) {
  const response = await fetch(media.bannerImage);
  const bytes = response.ok ? await response.arrayBuffer() : null;
  if (bytes !== null) {
    await writeFile(join(out, "banner.jpg"), new Uint8Array(bytes));
  }
}

const titles = new Map((media.streamingEpisodes ?? []).map((episode) => [Number(/^Episode\s+(?<number>\d+)/iu.exec(episode.title)?.groups?.["number"]), episode.title]));
await writeFile(join(out, "snapshot.json"), JSON.stringify({
  key,
  show: folder,
  media,
  episodes: entries.map(({ entry, number, thumbnail }) => ({
    entry, thumbnail, title: titles.get(number) ?? `Episode ${String(number)}`,
  })),
}, null, 2));
console.log(`${String(entries.length)} episodes → ${out}`);
