import {
  ChevronDown,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, type ChangeEvent, type MouseEvent } from "react";
import { formatDuration } from "../format.ts";
import type { AudioTrack, SubtitleTrack } from "../types.ts";
import { Collapsible, CollapsibleContent } from "./ui/collapsible.tsx";
import { PlaybackTimeline } from "./PlaybackTimeline.tsx";

type SubtitleSize = "small" | "medium" | "large";

export interface SubtitleAppearance {
  readonly size: SubtitleSize;
}

interface PlayerControlsProps {
  readonly mediaPath: string;
  readonly bufferedUntil: number;
  readonly currentTime: number;
  readonly duration: number;
  readonly muted: boolean;
  readonly volume: number;
  readonly fullscreen: boolean;
  readonly previousAvailable: boolean;
  readonly nextAvailable: boolean;
  readonly tracks: readonly SubtitleTrack[];
  readonly audioTracks: readonly AudioTrack[];
  readonly selectedAudioTrack: number | null;
  readonly selectedTrack: number | null;
  readonly appearance: SubtitleAppearance;
  readonly settingsOpen: boolean;
  readonly onTimelineInteractionEnd: () => void;
  readonly onTimelineInteractionStart: () => void;
  readonly onSeek: (time: number) => void;
  readonly onSeekBy: (seconds: number) => void;
  readonly onVolume: (volume: number) => void;
  readonly onToggleMuted: () => void;
  readonly onToggleFullscreen: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToggleSettings: () => void;
  readonly onTrack: (track: number | null) => void;
  readonly onAudioTrack: (track: number) => void;
  readonly onAppearance: (appearance: SubtitleAppearance) => void;
}

const controlClass = "relative flex size-11 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground";

interface SeekButtonProps {
  readonly label: string;
  readonly seconds: number;
  readonly onSeekBy: (seconds: number) => void;
  readonly direction: "back" | "forward";
}

function SeekButton({ label, seconds, onSeekBy, direction }: SeekButtonProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSeekBy(seconds);
  }, [onSeekBy, seconds]);
  return (
    <button type="button" className={controlClass} onClick={handleClick} aria-label={label} title={label}>
      {direction === "back" ? <RotateCcw className="size-5" /> : <RotateCw className="size-5" />}
      <span className="absolute text-[9px] font-bold">10</span>
    </button>
  );
}

function IntroSkipButton({ onSeekBy }: Pick<PlayerControlsProps, "onSeekBy">): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSeekBy(85);
  }, [onSeekBy]);
  return (
    <button type="button" onClick={handleClick} className="absolute bottom-20 right-3 rounded-md border border-border bg-black px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      Skip intro · 85s
    </button>
  );
}

function optionClass(active: boolean): string {
  return active
    ? "rounded-md bg-primary px-3 py-2 text-sm font-semibold capitalize text-primary-foreground"
    : "rounded-md bg-secondary px-3 py-2 text-sm capitalize text-secondary-foreground hover:bg-accent";
}

interface SubtitleMenuProps {
  readonly tracks: readonly SubtitleTrack[];
  readonly selectedTrack: number | null;
  readonly appearance: SubtitleAppearance;
  readonly onTrack: (track: number | null) => void;
  readonly onAppearance: (appearance: SubtitleAppearance) => void;
  readonly audioTracks: readonly AudioTrack[];
  readonly selectedAudioTrack: number | null;
  readonly onAudioTrack: (track: number) => void;
}

function SubtitleMenu({
  tracks,
  selectedTrack,
  appearance,
  onTrack,
  onAppearance,
  audioTracks,
  selectedAudioTrack,
  onAudioTrack,
}: SubtitleMenuProps): React.JSX.Element {
  const handleTrack = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.currentTarget;
    onTrack(value === "" ? null : Number(value));
  }, [onTrack]);
  const handleSize = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const size = event.currentTarget.dataset["value"];
    if (size === "small" || size === "medium" || size === "large") {
      onAppearance({ size });
    }
  }, [onAppearance]);
  const handleAudioTrack = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.currentTarget.value);
    if (Number.isInteger(value)) {
      onAudioTrack(value);
    }
  }, [onAudioTrack]);
  return (
    <div className="p-4">
      {audioTracks.length > 1 && (
        <div className="mb-4">
          <label className="mb-2 block text-sm font-semibold" htmlFor="player-audio-track">Audio</label>
          <div className="relative">
              <select
                id="player-audio-track"
                value={selectedAudioTrack ?? ""}
                onChange={handleAudioTrack}
                className="h-10 w-full appearance-none rounded-md border border-border bg-secondary px-3 pr-9 text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {audioTracks.map((track) => (
                  <option key={track.index} value={track.index}>{track.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      )}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-semibold" htmlFor="player-subtitle-track">Subtitles</label>
        <div className="relative">
          <select
            id="player-subtitle-track"
            value={selectedTrack ?? ""}
            onChange={handleTrack}
            className="h-10 w-full appearance-none rounded-md border border-border bg-secondary px-3 pr-9 text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Off</option>
            {tracks.map((track) => (
              <option key={track.index} value={track.index}>{track.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
      <h3 className="mb-2 text-sm font-semibold">Text size</h3>
      <div className="grid grid-cols-3 gap-2">
        {(["small", "medium", "large"] as const).map((size) => (
          <button
            key={size}
            type="button"
            data-value={size}
            className={optionClass(appearance.size === size)}
            onClick={handleSize}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeDisplay({ currentTime, duration }: {
  readonly currentTime: number;
  readonly duration: number;
}): React.JSX.Element {
  return (
    <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:text-sm">
      {formatDuration(currentTime)} / {formatDuration(duration)}
    </span>
  );
}

function VolumeControl({
  muted,
  volume,
  onToggleMuted,
  onVolume,
}: Pick<PlayerControlsProps, "muted" | "volume" | "onToggleMuted" | "onVolume">): React.JSX.Element {
  const handleVolume = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    onVolume(event.currentTarget.valueAsNumber);
  }, [onVolume]);
  return (
    <div data-player-volume className="hidden items-center sm:flex">
      <button type="button" className={controlClass} onClick={onToggleMuted} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>
      <label className="w-20">
        <span className="sr-only">Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={handleVolume} className="w-full accent-primary" />
      </label>
    </div>
  );
}

export function PlayerControls(props: PlayerControlsProps): React.JSX.Element {
  const safeDuration = Math.max(props.duration, 0);
  const safeTime = Math.min(Math.max(props.currentTime, 0), safeDuration);
  const bufferedAhead = Math.max(0, props.bufferedUntil - safeTime);
  return (
    <Collapsible open={props.settingsOpen} asChild>
    <div className="player-safe-controls relative px-2 pb-2 sm:px-3">
      <PlaybackTimeline bufferedUntil={props.bufferedUntil} currentTime={safeTime} duration={safeDuration} mediaPath={props.mediaPath} onInteractionEnd={props.onTimelineInteractionEnd} onInteractionStart={props.onTimelineInteractionStart} onSeek={props.onSeek} />
      <div className="flex items-center gap-1">
        <button type="button" className={controlClass} disabled={!props.previousAvailable} onClick={props.onPrevious} aria-label="Previous episode" title="Previous episode">
          <SkipBack className="size-5" />
        </button>
        <SeekButton label="Back 10 seconds" seconds={-10} direction="back" onSeekBy={props.onSeekBy} />
        <SeekButton label="Forward 10 seconds" seconds={10} direction="forward" onSeekBy={props.onSeekBy} />
        <button type="button" className={controlClass} disabled={!props.nextAvailable} onClick={props.onNext} aria-label="Next episode" title="Next episode">
          <SkipForward className="size-5" />
        </button>
        <span className="hidden sm:inline">
          <TimeDisplay currentTime={safeTime} duration={safeDuration} />
        </span>
        <output className="ml-1 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {String(Math.round(bufferedAhead))}s buffered
        </output>
        <span className="flex-1" />
        <VolumeControl muted={props.muted} volume={props.volume} onToggleMuted={props.onToggleMuted} onVolume={props.onVolume} />
        <button type="button" className={controlClass} onClick={props.onToggleSettings} aria-label="Playback settings" title="Playback settings">
          <Settings2 className="size-5" />
        </button>
        <button type="button" className={controlClass} onClick={props.onToggleFullscreen} aria-label={props.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={props.fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
          {props.fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
        </button>
      </div>
      <CollapsibleContent className="absolute bottom-16 right-2 z-20 max-h-[min(28rem,70vh)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
        <SubtitleMenu
          tracks={props.tracks}
          selectedTrack={props.selectedTrack}
          appearance={props.appearance}
          audioTracks={props.audioTracks}
          selectedAudioTrack={props.selectedAudioTrack}
          onTrack={props.onTrack}
          onAudioTrack={props.onAudioTrack}
          onAppearance={props.onAppearance}
        />
      </CollapsibleContent>
      {!props.settingsOpen && <IntroSkipButton onSeekBy={props.onSeekBy} />}
    </div>
    </Collapsible>
  );
}
