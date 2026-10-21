// Show art from AniList (and its Crunchyroll episode stills) goes through
// /api/art, which resizes it to the width the page needs and serves WebP. A
// 1900 px banner in a 300 px tile drops from ~330 KB to ~30 KB.
const PROXIED_HOSTS = new Set(["s4.anilist.co", "img1.ak.crunchyroll.com"]);

/** Widths for an image `sizes` says is about `widest` CSS px or less, at 1x-2x density. */
export const ART_WIDTHS = {
  cover: [160, 320, 480],
  still: [320, 480, 640],
  tile: [480, 640, 960],
  banner: [640, 960, 1280, 1920],
} as const;

export type ArtSize = keyof typeof ART_WIDTHS;

function proxied(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && PROXIED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function artUrl(source: string, width: number): string {
  return `/api/art?${new URLSearchParams({ src: source, w: String(width) }).toString()}`;
}

export interface ArtSources {
  readonly src: string;
  readonly srcSet: string | undefined;
}

/** `src` (the middle width) and `srcSet` for show art; anything else (local thumbnails) is left alone. */
export function artSources(source: string, size: ArtSize): ArtSources {
  if (!proxied(source)) {
    return { src: source, srcSet: undefined };
  }
  const widths = ART_WIDTHS[size];
  return {
    src: artUrl(source, widths[1]),
    srcSet: widths.map((width) => `${artUrl(source, width)} ${String(width)}w`).join(", "),
  };
}
