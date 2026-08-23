const MINIMUM_PLAYBACK_PROGRESS_SECONDS = 30;

export { preloadPlayer } from "../routeModules.ts";

export function hasMeaningfulPlaybackProgress(position: number): boolean {
  return position > MINIMUM_PLAYBACK_PROGRESS_SECONDS;
}
