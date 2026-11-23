import { ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import type { AudioTrack, PlayerStreamChoice, SubtitleTrack } from "../types.ts";
import { PlayerPanel, PlayerPanelOption } from "./PlayerPanel.tsx";

type SubtitleSize = "small" | "medium" | "large";

export interface SubtitleAppearance {
  readonly size: SubtitleSize;
}

export interface PlayerTrackSettings {
  readonly audioTracks: readonly AudioTrack[];
  readonly selectedAudioTrack: number | null;
  readonly onAudioTrack: (track: number) => void;
  readonly subtitles: readonly SubtitleTrack[];
  readonly selectedSubtitle: number | null;
  readonly onSubtitle: (track: number | null) => void;
  readonly appearance: SubtitleAppearance;
  readonly onAppearance: (appearance: SubtitleAppearance) => void;
  /** Original or converted video; null when there's no choice (offline copies). */
  readonly stream: PlayerStreamChoice | null;
}

type TrackView = "audio" | "subtitles" | "size" | "video";

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly active: boolean;
  readonly handleSelect: () => void;
}

const SIZES: readonly SubtitleSize[] = ["small", "medium", "large"];
const TITLES = { audio: "Audio", subtitles: "Subtitles", size: "Text size", video: "Video" } as const;

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function audioChoices(settings: PlayerTrackSettings): readonly Choice[] {
  return settings.audioTracks.map((track) => ({
    key: String(track.index),
    label: track.label,
    active: track.index === settings.selectedAudioTrack,
    handleSelect: () => { settings.onAudioTrack(track.index); },
  }));
}

function subtitleChoices(settings: PlayerTrackSettings): readonly Choice[] {
  return [
    { key: "off", label: "Off", active: settings.selectedSubtitle === null, handleSelect: () => { settings.onSubtitle(null); } },
    ...settings.subtitles.map((track) => ({
      key: String(track.index),
      label: track.label,
      active: track.index === settings.selectedSubtitle,
      handleSelect: () => { settings.onSubtitle(track.index); },
    })),
  ];
}

function sizeChoices(settings: PlayerTrackSettings): readonly Choice[] {
  return SIZES.map((size) => ({
    key: size,
    label: capitalized(size),
    active: settings.appearance.size === size,
    handleSelect: () => { settings.onAppearance({ size }); },
  }));
}

function videoChoices(stream: PlayerStreamChoice | null): readonly Choice[] {
  if (stream === null) {
    return [];
  }
  return [
    { key: "original", label: "Original", active: !stream.converted, handleSelect: () => { stream.onConverted(false); } },
    { key: "converted", label: "Converted", active: stream.converted, handleSelect: () => { stream.onConverted(true); } },
  ];
}

function choicesFor(view: TrackView, settings: PlayerTrackSettings): readonly Choice[] {
  if (view === "audio") {
    return audioChoices(settings);
  }
  if (view === "subtitles") {
    return subtitleChoices(settings);
  }
  return view === "size" ? sizeChoices(settings) : videoChoices(settings.stream);
}

/** The settings worth a row: a single audio track or a stream with no alternative has nothing to pick. */
function shownViews(settings: PlayerTrackSettings): readonly TrackView[] {
  const views: readonly (TrackView | null)[] = [
    settings.audioTracks.length > 1 ? "audio" : null,
    "subtitles",
    "size",
    settings.stream === null ? null : "video",
  ];
  return views.filter((view) => view !== null);
}

function SettingRow({ view, value, onOpen }: {
  readonly view: TrackView;
  readonly value: string;
  readonly onOpen: (view: TrackView) => void;
}): React.JSX.Element {
  const handleClick = useCallback(() => {
    onOpen(view);
  }, [onOpen, view]);
  return (
    <button type="button" onClick={handleClick} className="flex min-h-12 w-full items-center gap-3 rounded-md text-left text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="shrink-0">{TITLES[view]}</span>
      <span className="ml-auto min-w-0 truncate text-sm text-muted-foreground">{value}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

interface PlayerTracksProps {
  readonly settings: PlayerTrackSettings;
  readonly onClose: () => void;
}

/** Audio, subtitles, text size and video: one row each showing the current pick, opening its choices. */
export function PlayerTracks({ settings, onClose }: PlayerTracksProps): React.JSX.Element {
  const [view, setView] = useState<TrackView | null>(null);
  const handleBack = useCallback(() => {
    setView(null);
  }, []);
  if (view === null) {
    return (
      <PlayerPanel title="Audio & subtitles" onClose={onClose}>
        <div className="mt-1 overflow-y-auto">
          {shownViews(settings).map((shown) => (
            <SettingRow key={shown} view={shown} value={choicesFor(shown, settings).find((choice) => choice.active)?.label ?? ""} onOpen={setView} />
          ))}
        </div>
      </PlayerPanel>
    );
  }
  return (
    <PlayerPanel key={view} title={TITLES[view]} onBack={handleBack} onClose={onClose}>
      <div className="mt-1 overflow-y-auto">
        {choicesFor(view, settings).map((choice) => (
          <PlayerPanelOption key={choice.key} label={choice.label} active={choice.active} onSelect={choice.handleSelect} />
        ))}
        {view === "subtitles" && settings.subtitles.length === 0 && (
          <p className="mt-2 text-muted-foreground">No compatible subtitles found.</p>
        )}
      </div>
    </PlayerPanel>
  );
}
