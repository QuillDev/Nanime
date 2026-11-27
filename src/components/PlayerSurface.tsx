import { useMemo, useRef, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "../hooks/usePlayerProgress.ts";
import { usePlayerVideo } from "../hooks/usePlayerVideo.ts";
import {
  subtitleClass,
  useControlVisibility,
  usePlaybackEvents,
  usePlayerPanel,
  usePlayerSurfaceInteraction,
  useSubtitleDisplay,
} from "../hooks/usePlayerPresentation.ts";
import { useAudioSelection, useSubtitleTracks } from "../hooks/useSubtitleTracks.ts";
import type { EpisodeDisplay, MediaEntry, PlayerStreamChoice, PreferredAudioLanguage, SubtitleTrack } from "../types.ts";
import { PlayerCenter, PlayerPanels, PlayerTopBar } from "./PlayerChrome.tsx";
import { PlayerControls } from "./PlayerControls.tsx";
import { PlayerDiagnostics, PlayerErrors, PlayerPlaybackOverlay } from "./PlayerPlaybackOverlay.tsx";
import { SubtitleTracks } from "./SubtitleTracks.tsx";

const EMPTY_SUBTITLES: readonly SubtitleTrack[] = [];

type PanelsProps = React.ComponentProps<typeof PlayerPanels>;

interface PlayerSurfaceProps {
  readonly playbackLocked: boolean;
  readonly library: PanelsProps["library"];
  readonly party: PanelsProps["party"];
  readonly onClose: () => void;
  readonly entry: MediaEntry;
  readonly preferredAudioLanguage: PreferredAudioLanguage | null;
  readonly playbackMode: "direct" | "hls";
  readonly episodeDisplay: EpisodeDisplay | null;
  readonly timelineOffset: number;
  readonly knownDuration: number;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePlaying: () => void;
  readonly handleSourceMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly progress: PlaybackHandlers;
  readonly nextAvailable: boolean;
  readonly onNext: () => void;
  readonly onAudioTrack: (index: number) => void;
  readonly onTimelineSeek: (position: number) => void;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly stream: PlayerStreamChoice | null;
}

function usePlayerTracks(
  entry: MediaEntry,
  onAudioTrack: (index: number) => void,
  preferredLanguage: PreferredAudioLanguage | null,
) {
  const subtitles = useSubtitleTracks(entry.rel);
  const audio = useAudioSelection(entry.rel, onAudioTrack, {
    enabled: entry.offlineUrl === undefined,
    preferredLanguage,
  });
  return { audio, subtitles };
}

interface PlayerInterfaceProps extends Pick<PlayerSurfaceProps, "entry" | "episodeDisplay" | "library" | "party" | "videoRef" | "playbackLocked" | "nextAvailable" | "onNext" | "onClose" | "stream"> {
  readonly controls: ReturnType<typeof usePlayerVideo>["controls"];
  readonly buffering: boolean;
  readonly visibility: ReturnType<typeof useControlVisibility>;
  readonly panels: ReturnType<typeof usePlayerPanel>;
  readonly audio: ReturnType<typeof useAudioSelection>;
  readonly subtitles: readonly SubtitleTrack[];
  readonly display: ReturnType<typeof useSubtitleDisplay>;
  readonly onCenterPlayback: () => void;
}

/** Everything drawn over the picture: the title bar, the middle controls, the bottom bar and the open side panel. */
function PlayerInterface({
  entry, episodeDisplay, library, party, videoRef, playbackLocked, nextAvailable, onNext, onClose, stream,
  controls, buffering, visibility, panels, audio, subtitles, display, onCenterPlayback,
}: PlayerInterfaceProps): React.JSX.Element {
  const { panel } = panels;
  const shown = visibility.visible || panel !== null;
  const tracks = useMemo(() => ({
    audioTracks: audio.tracks,
    selectedAudioTrack: audio.selectedTrack,
    onAudioTrack: audio.handleTrack,
    subtitles,
    selectedSubtitle: display.selectedTrack,
    onSubtitle: display.handleTrack,
    appearance: display.appearance,
    onAppearance: display.handleAppearance,
    stream,
  }), [audio.tracks, audio.selectedTrack, audio.handleTrack, subtitles, display.selectedTrack, display.handleTrack, display.appearance, display.handleAppearance, stream]);
  return (
    <>
      {/* The controls stop at the open panel's edge rather than running under its blur. */}
      <div className={`pointer-events-none absolute inset-y-0 left-0 z-30 ${panel === null ? "right-0" : "right-0 sm:right-[20.5rem] lg:right-[25rem]"}`}>
        <div className={shown ? undefined : "invisible"}>
          <PlayerTopBar entry={entry} display={episodeDisplay} library={library} partyAvailable={party !== null} partyActive={party !== null && (party.host !== null || party.guestId !== null)} partyOpen={panel === "party"} onBack={onClose} onParty={panels.handleParty} />
        </div>
        <PlayerCenter shown={shown || controls.paused} paused={controls.paused} buffering={buffering} onTogglePlayback={onCenterPlayback} onSeekBy={controls.handleSeekBy} />
        <div data-player-controls className={`absolute inset-x-0 bottom-0 ${shown ? "" : "invisible"}`}>
          <PlayerControls
            mediaPath={entry.rel}
            bufferedUntil={controls.bufferedUntil}
            currentTime={controls.currentTime}
            duration={controls.duration}
            muted={controls.muted}
            volume={controls.volume}
            fullscreen={controls.fullscreen}
            episodesAvailable={!playbackLocked}
            nextAvailable={nextAvailable}
            openMenu={panel === "party" ? null : panel}
            skipShown={panel === null}
            selectedAudioTrack={audio.selectedTrack}
            converted={stream?.converted === true}
            onTimelineInteractionEnd={visibility.handleInteractionEnd}
            onTimelineInteractionStart={visibility.handleInteractionStart}
            onSeek={controls.handleSeek}
            onSeekBy={controls.handleSeekBy}
            onVolume={controls.handleVolume}
            onToggleMuted={controls.handleToggleMuted}
            onToggleFullscreen={controls.handleToggleFullscreen}
            onNext={onNext}
            onMenu={panels.handleToggle}
          />
        </div>
      </div>
      <PlayerPanels panel={panel} rel={entry.rel} library={library} tracks={tracks} party={party} videoRef={videoRef} onClose={panels.handleClose} />
    </>
  );
}

export function PlayerSurface({
  entry, preferredAudioLanguage, playbackMode, playbackLocked,
  episodeDisplay, timelineOffset, knownDuration, videoRef,
  setVideo, handleVideoError, handlePlaying, handleSourceMetadata, progress,
  nextAvailable, onNext, onClose, library, party,
  onAudioTrack, onTimelineSeek, playbackPosition, stream,
}: PlayerSurfaceProps): React.JSX.Element {
  const { audio, subtitles } = usePlayerTracks(entry, onAudioTrack, preferredAudioLanguage);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const {
    buffering,
    controls,
    frameRef,
    frameVisible,
    handleBuffering,
    handleLoadStart,
    handleReady,
    handlePlayerPlaying,
    handlePlayerSeeked,
    handlePlayerTimeUpdate,
  } = usePlayerVideo({
    videoRef, playbackLocked, playerRef,
    progress,
    onPlaying: handlePlaying,
    knownDuration,
    onTimelineSeek,
    playbackPosition,
  });
  const visibility = useControlVisibility();
  const playbackEvents = usePlaybackEvents(
    progress,
    controls,
    { onPlay: visibility.handleActivity, onSourceMetadata: handleSourceMetadata },
  );
  const display = useSubtitleDisplay(subtitles.data);
  const panels = usePlayerPanel();
  const controlsVisible = visibility.visible || panels.panel !== null;
  const interaction = usePlayerSurfaceInteraction({
    playerRef, controlsVisible,
    onTogglePlayback: controls.handleTogglePlayback,
    onShowControls: visibility.handleActivity,
    onHideControls: visibility.handleHide,
    onSeekBy: controls.handleSeekBy,
  });
  return (
    <div
      ref={playerRef}
      data-player-controls-visible={controlsVisible}
      className="relative h-full w-full overflow-hidden bg-black"
      onPointerMove={interaction.handlePointerMove}
    >
        <div className="relative flex h-full w-full items-center justify-center bg-black [container-type:size]">
          <video
            ref={setVideo}
            crossOrigin="anonymous"
            playsInline
            onError={handleVideoError}
            onLoadStart={handleLoadStart}
            onLoadedData={handleReady}
            onCanPlay={handleReady}
            onWaiting={handleBuffering}
            onSeeking={handleBuffering}
            onPlaying={handlePlayerPlaying}
            onPlay={playbackEvents.handlePlay}
            onLoadedMetadata={playbackEvents.handleLoadedMetadata}
            onProgress={controls.handleProgress}
            onDurationChange={controls.handleDurationChange}
            onTimeUpdate={handlePlayerTimeUpdate}
            onPause={playbackEvents.handlePause}
            onSeeked={handlePlayerSeeked}
            onEnded={playbackEvents.handleEnded}
            onResize={display.handleVideoResize}
            className="h-full w-full bg-black object-contain"
          >
            <track kind="captions" />
            <SubtitleTracks rel={entry.rel} tracks={subtitles.data} selectedTrack={display.selectedTrack} timelineOffset={timelineOffset} onCueText={display.handleCueText} />
          </video>
          <canvas
            ref={frameRef}
            className={`pointer-events-none absolute inset-0 z-[1] h-full w-full bg-black object-contain${frameVisible ? "" : " hidden"}`}
            aria-hidden="true"
          />
          <PlayerPlaybackOverlay onSurfacePointerUp={interaction.handleSurfacePointerUp} onSurfaceClick={interaction.handleSurfaceClick} />
          <PlayerDiagnostics
            buffering={buffering}
            controlsVisible={controlsVisible}
            frameVisible={frameVisible}
            playbackMode={playbackMode}
            videoRef={videoRef}
          />
          {display.cueText !== "" && (
            <div className="pointer-events-none absolute inset-0 z-10 m-auto" style={display.pictureStyle}>
              <div
                className="player-subtitle-position absolute inset-x-0 flex justify-center px-3"
                aria-live="off"
              >
                <span className={subtitleClass(display.appearance)}>{display.cueText}</span>
              </div>
            </div>
          )}
        </div>
        <PlayerInterface
          entry={entry} episodeDisplay={episodeDisplay} library={library} party={party} videoRef={videoRef}
          playbackLocked={playbackLocked} nextAvailable={nextAvailable} onNext={onNext} onClose={onClose} stream={stream}
          controls={controls} buffering={buffering} visibility={visibility} panels={panels} audio={audio}
          subtitles={subtitles.data ?? EMPTY_SUBTITLES} display={display} onCenterPlayback={interaction.handleCenterPlayback}
        />
        <PlayerErrors subtitleError={subtitles.error} audioError={audio.error} fullscreenError={controls.fullscreenError} />
    </div>
  );
}
