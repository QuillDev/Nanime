/** Splits dropped or browsed files into torrents and library videos; everything else is ignored. */
const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "webm", "mov", "mkv", "avi", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg", "ogv", "3gp",
]);

export const ADD_MEDIA_ACCEPT = [".torrent", ...[...VIDEO_EXTENSIONS].map((extension) => `.${extension}`)].join(",");

function fileExtension(name: string): string {
  return name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
}

export interface SortedFiles {
  readonly torrents: readonly File[];
  readonly videos: readonly File[];
}

export function sortAddedFiles(files: readonly File[]): SortedFiles {
  return {
    torrents: files.filter((file) => fileExtension(file.name) === "torrent"),
    videos: files.filter((file) => VIDEO_EXTENSIONS.has(fileExtension(file.name))),
  };
}

export function isMagnetLink(value: string): boolean {
  return value.trim().toLocaleLowerCase().startsWith("magnet:");
}
