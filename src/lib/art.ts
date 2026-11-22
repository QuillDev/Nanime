import { isAllowedArtUrl } from "../../shared/artHosts.ts";
import type { AniListMedia } from "../types.ts";

/** Widths for an image `sizes` says is about `widest` CSS px or less, at 1x-2x density. */
export const ART_WIDTHS = {
  cover: [160, 320, 480],
  still: [320, 480, 640],
  tile: [480, 640, 960],
  banner: [640, 960, 1280, 1920],
} as const;

export type ArtSize = keyof typeof ART_WIDTHS;

function artUrl(source: string, width: number): string {
  return `/api/art?${new URLSearchParams({ src: source, w: String(width) }).toString()}`;
}

export interface ArtSources {
  readonly src: string;
  readonly srcSet: string | undefined;
}

/** `src` (the middle width) and `srcSet` for show art; anything else (local thumbnails) is left alone. */
export function artSources(source: string, size: ArtSize): ArtSources {
  if (!isAllowedArtUrl(source)) {
    return { src: source, srcSet: undefined };
  }
  const widths = ART_WIDTHS[size];
  return {
    src: artUrl(source, widths[1]),
    srcSet: widths.map((width) => `${artUrl(source, width)} ${String(width)}w`).join(", "),
  };
}

/** The show's poster, at widths that fill a phone's screen. */
export function posterArt(media: AniListMedia | undefined): ArtSources | null {
  const cover = media?.coverImage.extraLarge ?? media?.coverImage.large ?? null;
  return cover === null ? null : artSources(cover, "tile");
}
