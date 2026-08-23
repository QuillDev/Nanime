import { readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import type { MediaEntry } from "../shared/types.ts";

interface WalkOptions {
  readonly mediaDir: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
  readonly entries: MediaEntry[];
}

async function walk(directory: string, options: WalkOptions): Promise<void> {
  const items = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const item of items) {
    const absolutePath = join(directory, item.name);
    if (item.isDirectory() && !item.name.startsWith(".nanime-")) {
      await walk(absolutePath, options);
    } else if (item.isFile() && options.videoExtensions.has(extname(item.name).toLowerCase())) {
      const { size } = await stat(absolutePath).catch(() => ({ size: 0 }));
      const rel = relative(options.mediaDir, absolutePath);
      const folder = dirname(rel);
      options.entries.push({
        rel,
        name: item.name,
        folder: folder === "." ? "" : folder,
        size,
        direct: options.directPlayExtensions.has(extname(item.name).toLowerCase()),
      });
    }
  }
}

export async function listMedia(
  mediaDir: string,
  videoExtensions: ReadonlySet<string>,
  directPlayExtensions: ReadonlySet<string>,
): Promise<readonly MediaEntry[]> {
  const entries: MediaEntry[] = [];
  await walk(mediaDir, { mediaDir, videoExtensions, directPlayExtensions, entries });
  return entries;
}
