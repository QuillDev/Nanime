import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { trickplayFrameUrl, trickplaySheetUrl } from "../api.ts";
import { formatDuration } from "../format.ts";
import { useTrickplay } from "../hooks/useTrickplay.ts";
import { trickplayTile } from "../lib/trickplay.ts";

interface TimelinePreviewProps {
  readonly mediaPath: string;
  readonly percent: number;
  readonly time: number;
}

function useFallbackTime(time: number): number {
  const [settledTime, setSettledTime] = useState(time);
  useEffect(() => {
    const timer = setTimeout(() => setSettledTime(time), 120);
    return () => clearTimeout(timer);
  }, [time]);
  return settledTime;
}

function FallbackPreview({ mediaPath, time }: {
  readonly mediaPath: string;
  readonly time: number;
}): React.JSX.Element {
  const source = trickplayFrameUrl(mediaPath, time);
  const [loaded, setLoaded] = useState(false);
  const handleLoad = useCallback(() => setLoaded(true), []);
  return (
    <span className="relative block aspect-[30/17] w-60 overflow-hidden bg-secondary">
      {!loaded && <span className="absolute inset-0 animate-pulse bg-secondary" />}
      <img
        src={source}
        alt=""
        onLoad={handleLoad}
        className={`block h-full w-full bg-black object-contain transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </span>
  );
}

export function TimelinePreview({ mediaPath, percent, time }: TimelinePreviewProps): React.JSX.Element {
  const trickplay = useTrickplay(mediaPath);
  const fallbackTime = useFallbackTime(time);
  const manifest = trickplay.data;
  const readyStyle = useMemo((): CSSProperties | null => {
    if (manifest?.status !== "ready") {
      return null;
    }
    const tile = trickplayTile(manifest, time);
    return {
      backgroundImage: `url("${trickplaySheetUrl(mediaPath, manifest.version, tile.sheet)}")`,
      backgroundPosition: `-${String(tile.x)}px -${String(tile.y)}px`,
      height: manifest.height,
      width: manifest.width,
    };
  }, [manifest, mediaPath, time]);
  const positionStyle = useMemo((): CSSProperties => ({
    left: `clamp(7.75rem, ${String(percent)}%, calc(100% - 7.75rem))`,
  }), [percent]);
  return (
    <output
      aria-hidden="true"
      className="pointer-events-none absolute bottom-6 z-30 -translate-x-1/2 overflow-hidden rounded-lg border border-primary bg-black shadow-2xl"
      style={positionStyle}
    >
      {readyStyle === null
        ? <FallbackPreview key={`${mediaPath}:${String(fallbackTime)}`} mediaPath={mediaPath} time={fallbackTime} />
        : <span className="block bg-black bg-no-repeat" style={readyStyle} />}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-2 pt-5 text-center text-sm font-semibold tabular-nums text-white">
        {formatDuration(time)}
      </span>
    </output>
  );
}
