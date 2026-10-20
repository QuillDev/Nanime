/**
 * The show and season a library folder stands for, read from its path. The
 * client groups videos by these names and the server uses the same names for
 * the metadata keys it builds from `nanime.json` files, so both sides must
 * parse folders identically.
 */

export interface FolderIdentity {
  readonly show: string;
  readonly season: string;
}

/** Season tags in release folder names: `(Season 03)`, `(Season 03 pt.2)`, `(Season 3 Part 2)`, or a bare ` S03 `. */
const SEASON_TAGS = [
  /\(Season\s+0*(?<number>\d+)(?:\s*(?:pt\.?|part)\s*0*(?<part>\d+))?\)/iu,
  /\sS0*(?<number>\d{1,2})(?![\dE])/u,
] as const;

export function pathParts(folder: string): readonly string[] {
  return folder.split("/").filter((part) => part !== "");
}

function releaseTitle(folder: string, seasonIndex: number): string {
  const beforeSeason = folder.slice(0, seasonIndex).trim();
  const alias = /\((?<title>[^()]*)\)$/u.exec(beforeSeason)?.groups?.["title"];
  return alias?.trim() || beforeSeason.replace(/^\[[^\]]+\]\s*/u, "");
}

function releaseIdentity(top: string): FolderIdentity {
  const match = SEASON_TAGS.map((pattern) => pattern.exec(top)).find((found) => found !== null);
  const number = match?.groups?.["number"];
  if (match === undefined || number === undefined) {
    return { show: top, season: "Episodes" };
  }
  const part = match.groups?.["part"];
  return {
    show: releaseTitle(top, match.index),
    season: `Season ${String(Number(number))}${part === undefined ? "" : ` Part ${String(Number(part))}`}`,
  };
}

/** The identity of videos directly inside `folder` (a library-relative path). */
export function folderIdentity(folder: string): FolderIdentity {
  const parts = pathParts(folder);
  const top = parts[0] ?? "Unsorted";
  const nested = parts.slice(1).join(" / ");
  return nested === "" ? releaseIdentity(top) : { show: top, season: nested };
}

export function showMetadataKey(show: string): string {
  return `show:${show}`;
}

export function seasonMetadataKey(show: string, season: string): string {
  return `season:${show} / ${season}`;
}
