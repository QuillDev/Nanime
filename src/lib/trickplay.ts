import type { TrickplayReady } from "../../shared/types.ts";

export interface TrickplayTile {
  readonly sheet: number;
  readonly x: number;
  readonly y: number;
}

export function trickplayTile(manifest: TrickplayReady, time: number): TrickplayTile {
  const frame = Math.min(
    Math.max(0, Math.floor(time / manifest.interval)),
    manifest.frameCount - 1,
  );
  const tilesPerSheet = manifest.columns * manifest.rows;
  const tile = frame % tilesPerSheet;
  return {
    sheet: Math.floor(frame / tilesPerSheet),
    x: tile % manifest.columns * manifest.width,
    y: Math.floor(tile / manifest.columns) * manifest.height,
  };
}
