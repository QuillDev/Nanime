import { ArrowLeft, LoaderCircle, Pause, Play, RotateCcw, RotateCw, UsersRound } from "lucide-react";
import { useCallback, type RefObject } from "react";
import { playerHeading, type PlayerLibrary } from "../lib/playerLibrary.ts";
import type { EpisodeDisplay, MediaEntry } from "../types.ts";
import { cn } from "../lib/utils.ts";
import { PlayerEpisodes } from "./PlayerEpisodes.tsx";
import { PlayerTracks, type PlayerTrackSettings } from "./PlayerTracks.tsx";
import { WatchTogether } from "./WatchTogether.tsx";

export type PlayerPanelName = "episodes" | "tracks" | "party";

const iconButton = "pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface PlayerTopBarProps {
  readonly entry: MediaEntry;
  readonly display: EpisodeDisplay | null;
  readonly library: PlayerLibrary;
  /** Shown when a party can be started or joined from here. */
  readonly partyAvailable: boolean;
  readonly partyActive: boolean;
  readonly partyOpen: boolean;
  readonly onBack: () => void;
  readonly onParty: () => void;
}

/** What is playing, with the way back on its left and the party on its right. */
export function PlayerTopBar({ entry, display, library, partyAvailable, partyActive, partyOpen, onBack, onParty }: PlayerTopBarProps): React.JSX.Element {
  const heading = playerHeading(library, entry, display);
  return (
    <div className="player-now-playing absolute inset-x-0 top-0 flex items-start gap-2 text-white">
      <button type="button" onClick={onBack} aria-label="Back" title="Back" className={`${iconButton} -ml-2.5 -mt-2`}>
        <ArrowLeft className="size-6" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[17px] font-bold leading-tight tracking-tight lg:text-[22px]">{heading.title}</p>
        {heading.detail !== null && <p className="mt-0.5 truncate text-sm text-foreground/85">{heading.detail}</p>}
      </div>
      {partyAvailable && (
        <button type="button" onClick={onParty} aria-label="Watch together" title="Watch together" aria-pressed={partyOpen} className={cn(iconButton, "-mr-2.5 -mt-2", partyOpen && "rounded-full bg-white text-black hover:bg-white", partyActive && !partyOpen && "text-primary")}>
          <UsersRound className="size-5" />
        </button>
      )}
    </div>
  );
}

interface SeekButtonProps {
  readonly seconds: number;
  readonly onSeekBy: (seconds: number) => void;
}

function SeekButton({ seconds, onSeekBy }: SeekButtonProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSeekBy(seconds);
  }, [onSeekBy, seconds]);
  const label = seconds < 0 ? "Back 10 seconds" : "Forward 10 seconds";
  const Icon = seconds < 0 ? RotateCcw : RotateCw;
  return (
    <button type="button" onClick={handleClick} aria-label={label} title={label} className="pointer-events-auto relative grid size-14 place-items-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-16">
      <Icon className="size-9 lg:size-11" strokeWidth={1.75} />
      <span className="absolute text-[13px] font-bold lg:text-base">10</span>
    </button>
  );
}

interface PlayerCenterProps {
  /** False while the controls are hidden over a playing video; the loading spinner shows regardless. */
  readonly shown: boolean;
  readonly paused: boolean;
  readonly buffering: boolean;
  readonly onTogglePlayback: () => void;
  readonly onSeekBy: (seconds: number) => void;
}

/** Play or pause between the two ten-second skips, straight on the picture. */
export function PlayerCenter({ shown, paused, buffering, onTogglePlayback, onSeekBy }: PlayerCenterProps): React.JSX.Element {
  return (
    <div className={cn("absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-8 drop-shadow-[0_1px_6px_rgb(0_0_0/0.6)] sm:gap-14 lg:gap-[72px]", !shown && "[&>button]:invisible")}>
      <SeekButton seconds={-10} onSeekBy={onSeekBy} />
      {buffering ? (
        <output className="grid size-16 place-items-center text-white lg:size-20" aria-label="Loading video">
          <LoaderCircle className="size-11 animate-spin lg:size-14" aria-hidden="true" />
        </output>
      ) : (
        <button type="button" data-player-primary onClick={onTogglePlayback} aria-label={paused ? "Play video" : "Pause video"} className="pointer-events-auto grid size-16 place-items-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-20">
          {paused ? <Play className="ml-1 size-11 fill-current lg:size-14" /> : <Pause className="size-11 fill-current lg:size-14" />}
        </button>
      )}
      <SeekButton seconds={10} onSeekBy={onSeekBy} />
    </div>
  );
}

interface PlayerPanelsProps {
  readonly panel: PlayerPanelName | null;
  readonly rel: string;
  readonly library: PlayerLibrary;
  readonly tracks: PlayerTrackSettings;
  /** Null where a party can't run (offline copies). */
  readonly party: React.ComponentProps<typeof WatchTogether>["session"] | null;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly onClose: () => void;
}

/** The open side panel, and under the controls a layer that closes it when the picture is tapped. */
export function PlayerPanels({ panel, rel, library, tracks, party, videoRef, onClose }: PlayerPanelsProps): React.JSX.Element | null {
  if (panel === null) {
    return null;
  }
  return (
    <>
      <button type="button" tabIndex={-1} aria-label="Close panel" onClick={onClose} className="absolute inset-0 z-[25] cursor-default focus:outline-none" />
      {panel === "episodes" && <PlayerEpisodes rel={rel} library={library} onClose={onClose} />}
      {panel === "tracks" && <PlayerTracks settings={tracks} onClose={onClose} />}
      {panel === "party" && party !== null && <WatchTogether session={party} videoRef={videoRef} onClose={onClose} />}
    </>
  );
}
