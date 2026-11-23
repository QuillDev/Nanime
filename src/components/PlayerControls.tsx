import { Captions, ListVideo, Maximize, Minimize, SkipForward, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { useCallback, type ChangeEvent } from "react";
import { formatDuration } from "../format.ts";
import { useConvertedProgress } from "../hooks/useConvertedProgress.ts";
import { cn } from "../lib/utils.ts";
import { ConvertedRanges } from "./ConvertedRanges.tsx";
import { PlaybackTimeline } from "./PlaybackTimeline.tsx";

/** The side panel a bottom button opens. */
export type PlayerMenu = "episodes" | "tracks";

interface PlayerControlsProps {
  readonly mediaPath: string;
  readonly bufferedUntil: number;
  readonly currentTime: number;
  readonly duration: number;
  readonly muted: boolean;
  readonly volume: number;
  readonly fullscreen: boolean;
  /** False while a party's host picks the episodes. */
  readonly episodesAvailable: boolean;
  readonly nextAvailable: boolean;
  readonly openMenu: PlayerMenu | null;
  /** Off while a side panel is open, so it never sits over the panel's edge. */
  readonly skipShown: boolean;
  readonly selectedAudioTrack: number | null;
  readonly converted: boolean;
  readonly onTimelineInteractionEnd: () => void;
  readonly onTimelineInteractionStart: () => void;
  readonly onSeek: (time: number) => void;
  readonly onSeekBy: (seconds: number) => void;
  readonly onVolume: (volume: number) => void;
  readonly onToggleMuted: () => void;
  readonly onToggleFullscreen: () => void;
  readonly onNext: () => void;
  readonly onMenu: (menu: PlayerMenu) => void;
}

const iconButton = "grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function IntroSkipButton({ onSeekBy }: Pick<PlayerControlsProps, "onSeekBy">): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSeekBy(85);
  }, [onSeekBy]);
  return (
    <button type="button" onClick={handleClick} title="Skip ahead 85 seconds" className="pointer-events-auto absolute bottom-full right-0 mb-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      Skip intro
    </button>
  );
}

interface MenuButtonProps {
  readonly menu: PlayerMenu;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly open: boolean;
  readonly onMenu: (menu: PlayerMenu) => void;
}

/** A worded button for a side panel; phones held upright keep only its icon. */
function MenuButton({ menu, label, icon: Icon, open, onMenu }: MenuButtonProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onMenu(menu);
  }, [menu, onMenu]);
  return (
    <button type="button" aria-label={label} aria-pressed={open} onClick={handleClick} className={cn("flex h-[38px] shrink-0 items-center gap-2 rounded-full px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", open ? "bg-white text-black" : "hover:bg-white/10")}>
      <Icon className="size-5" aria-hidden="true" />
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
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
    <div data-player-volume className="hidden items-center lg:flex">
      <button type="button" className={iconButton} onClick={onToggleMuted} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>
      <label className="mr-2 w-20">
        <span className="sr-only">Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={handleVolume} className="w-full accent-white" />
      </label>
    </div>
  );
}

function useConvertedOverlay(props: PlayerControlsProps): React.ReactNode {
  const progress = useConvertedProgress(props.mediaPath, props.selectedAudioTrack, props.converted);
  return progress === undefined ? null : <ConvertedRanges progress={progress} />;
}

function Time({ seconds }: { readonly seconds: number }): React.JSX.Element {
  return <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-foreground/85">{formatDuration(seconds)}</span>;
}

/** The bottom of the player: the timeline between its two times, then the worded buttons. */
export function PlayerControls(props: PlayerControlsProps): React.JSX.Element {
  const overlay = useConvertedOverlay(props);
  const duration = Math.max(props.duration, 0);
  const time = Math.min(Math.max(props.currentTime, 0), duration);
  return (
    <div className="player-safe-controls relative flex flex-col">
      <div className="pointer-events-auto flex items-center gap-3.5">
        <Time seconds={time} />
        <div className="min-w-0 flex-1">
          <PlaybackTimeline bufferedUntil={props.bufferedUntil} currentTime={time} duration={duration} mediaPath={props.mediaPath} onInteractionEnd={props.onTimelineInteractionEnd} onInteractionStart={props.onTimelineInteractionStart} onSeek={props.onSeek} overlay={overlay} />
        </div>
        <Time seconds={duration} />
      </div>
      <div className="pointer-events-auto -ml-4 -mr-3 flex items-center gap-1">
        {props.episodesAvailable && <MenuButton menu="episodes" label="Episodes" icon={ListVideo} open={props.openMenu === "episodes"} onMenu={props.onMenu} />}
        <MenuButton menu="tracks" label="Audio & subtitles" icon={Captions} open={props.openMenu === "tracks"} onMenu={props.onMenu} />
        <span className="flex-1" />
        <VolumeControl muted={props.muted} volume={props.volume} onToggleMuted={props.onToggleMuted} onVolume={props.onVolume} />
        <button type="button" disabled={!props.nextAvailable} onClick={props.onNext} aria-label="Next episode" title="Next episode" className="flex h-[38px] shrink-0 items-center gap-2 rounded-full px-4 text-[15px] font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:hover:bg-transparent">
          <span className="hidden whitespace-nowrap lg:inline">Next episode</span>
          <SkipForward className="size-5" aria-hidden="true" />
        </button>
        <button type="button" className={iconButton} onClick={props.onToggleFullscreen} aria-label={props.fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={props.fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
          {props.fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
        </button>
      </div>
      {/* Drawn above the timeline, but after the buttons so a remote reaches them first. */}
      <div className="relative order-first">
        {props.skipShown && <IntroSkipButton onSeekBy={props.onSeekBy} />}
      </div>
    </div>
  );
}
