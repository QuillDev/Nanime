import { useEffect, useRef } from "react";
import { subtitleUrl } from "../api.ts";
import type { SubtitleTrack } from "../types.ts";

const EMPTY_TRACKS: readonly SubtitleTrack[] = [];

function cueText(cue: TextTrackCue | undefined): string | null {
  return cue !== undefined && "text" in cue && typeof cue.text === "string"
    ? cue.text.replaceAll(/<[^>]+>/gu, "")
    : null;
}

function activeCueLines(activeCues: TextTrackCueList): readonly string[] {
  const lines: string[] = [];
  let index = 0;
  while (index < activeCues.length) {
    const text = cueText(activeCues[index]);
    if (text !== null) {
      lines.push(text);
    }
    index += 1;
  }
  return lines;
}

function activeCueText(track: TextTrack): string {
  return track.activeCues === null ? "" : activeCueLines(track.activeCues).join("\n");
}

interface SubtitleSourceProps {
  readonly active: boolean;
  readonly rel: string;
  readonly track: SubtitleTrack;
  readonly onCueText: (text: string) => void;
}

function SubtitleSource({
  active,
  rel,
  track,
  onCueText,
}: SubtitleSourceProps): React.JSX.Element {
  const elementRef = useRef<HTMLTrackElement | null>(null);

  useEffect(() => {
    const textTrack = elementRef.current?.track;
    if (textTrack === undefined) {
      return undefined;
    }
    textTrack.mode = active ? "hidden" : "disabled";
    if (!active) {
      return undefined;
    }
    const updateCue = (): void => {
      onCueText(activeCueText(textTrack));
    };
    textTrack.addEventListener("cuechange", updateCue);
    updateCue();
    return () => {
      textTrack.removeEventListener("cuechange", updateCue);
      textTrack.mode = "disabled";
      onCueText("");
    };
  }, [active, onCueText]);

  return (
    <track
      ref={elementRef}
      kind="captions"
      src={subtitleUrl(rel, track.index)}
      srcLang={track.language}
      label={track.label}
    />
  );
}

interface SubtitleTracksProps {
  readonly rel: string;
  readonly tracks: readonly SubtitleTrack[] | undefined;
  readonly selectedTrack: number | null;
  readonly onCueText: (text: string) => void;
}

export function SubtitleTracks({
  rel,
  tracks,
  selectedTrack,
  onCueText,
}: SubtitleTracksProps): React.JSX.Element {
  return (
    <>
      {(tracks ?? EMPTY_TRACKS).map((track) => (
        <SubtitleSource
          key={track.index}
          active={track.index === selectedTrack}
          rel={rel}
          track={track}
          onCueText={onCueText}
        />
      ))}
    </>
  );
}
