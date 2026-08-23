import type { SubtitleTrack } from "../types.ts";
import { subtitleUrl } from "../api.ts";

const EMPTY_TRACKS: readonly SubtitleTrack[] = [];

function subtitlePreference(track: SubtitleTrack): number {
  const english = /^(?:en|eng)$/iu.test(track.language) ? 100 : 0;
  const signsOnly = /signs?|songs?/iu.test(track.label) ? -50 : 0;
  const closedCaptions = /\bcc\b|\[cc\]/iu.test(track.label) ? -10 : 0;
  const plainEnglish = /^english$/iu.test(track.label.trim()) ? 20 : 0;
  return english + signsOnly + closedCaptions + plainEnglish;
}

function preferredSubtitle(tracks: readonly SubtitleTrack[]): number | null {
  return tracks.reduce<SubtitleTrack | null>((preferred, track) => (
    preferred === null || subtitlePreference(track) > subtitlePreference(preferred)
      ? track
      : preferred
  ), null)?.index ?? null;
}

interface SubtitleTracksProps {
  readonly rel: string;
  readonly tracks: readonly SubtitleTrack[] | undefined;
}

export function SubtitleTracks({ rel, tracks }: SubtitleTracksProps): React.JSX.Element {
  const available = tracks ?? EMPTY_TRACKS;
  const preferred = preferredSubtitle(available);
  return (
    <>
      {available.map((track) => (
        <track
          key={track.index}
          kind="subtitles"
          src={subtitleUrl(rel, track.index)}
          srcLang={track.language}
          label={track.label}
          default={track.index === preferred}
        />
      ))}
    </>
  );
}
