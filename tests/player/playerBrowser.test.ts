import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  clickElement,
  clickStableElement,
  elementVisible,
  showPlayerControls,
  waitForElement,
} from "./browserInteraction.ts";
import {
  COMMON_FIRST_FIXTURE,
  COMMON_SECOND_FIXTURE,
  DIRECT_FIXTURE,
  FIXTURE_DURATION,
  HLS_FAILURE_FIXTURE,
  HLS_FIXTURE,
  WATCHED_FIXTURE,
} from "./mediaFixture.ts";
import {
  captureFailure,
  type PlayerHarness,
  playerState,
  startPlayerHarness,
  timelineBounds,
  waitForPlayerState,
} from "./playerHarness.ts";

let harness: PlayerHarness | undefined = undefined;
const describeBrowser = Bun.env["NANIME_PLAYER_E2E"] === "true" ? describe : describe.skip;

function activeHarness(): PlayerHarness {
  if (harness === undefined) {
    throw new Error("Player harness has not started");
  }
  return harness;
}

async function ensurePlaying(player: Awaited<ReturnType<PlayerHarness["openPlayer"]>>): Promise<void> {
  const current = await playerState(player.view);
  if (current?.paused === false) {
    return;
  }
  const started = await player.view.evaluate<boolean>(`(() => {
    const video = document.querySelector("video");
    return video instanceof HTMLVideoElement
      ? video.play().then(() => true, () => false)
      : false;
  })()`);
  expect(started).toBe(true);
  await waitForPlayerState({
    view: player.view,
    predicate: (state) => !state.paused,
    description: "video to enter the playing state",
  });
}

async function verifyNoPlayerErrors(player: Awaited<ReturnType<PlayerHarness["openPlayer"]>>): Promise<void> {
  await waitForPlayerState({
    view: player.view,
    predicate: (state) => state.readyState >= 2,
    description: "video data to become ready",
  });
  await ensurePlaying(player);
  const state = await waitForPlayerState({
    view: player.view,
    predicate: (current) => current.timelinePosition > 0.5,
    description: "video playback to advance",
  });
  expect(state.error).toBeNull();
  expect(player.consoleErrors).toEqual([]);
}

async function waitForEpisodeRoute(view: Bun.WebView, rel: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await view.evaluate<string>("new URL(location.href).searchParams.get('episode') ?? ''");
    if (current === rel) {
      await waitForPlayerState({
        view,
        predicate: (state) => state.readyState >= 2,
        description: `${rel} player to become ready`,
      });
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for episode route: ${rel}`);
}

async function waitForElementHidden(
  view: Bun.WebView,
  target: Parameters<typeof elementVisible>[1],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await elementVisible(view, target))) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for element to hide: ${JSON.stringify(target)}`);
}

async function setPlaybackRate(view: Bun.WebView, rate: number): Promise<void> {
  const updated = await view.evaluate<boolean>(`(() => {
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return false;
    video.playbackRate = ${String(rate)};
    return video.playbackRate === ${String(rate)};
  })()`);
  expect(updated).toBe(true);
}

function registerCommonJourneyTests(): void {
  test("navigates through a season, streams quickly, skips time, and traverses episodes", async () => {
    const runtime = activeHarness();
    const player = await runtime.openApp();
    try {
      await clickElement(player.view, { selector: "button", text: "Browser Fixture Show" });
      const season = { selector: "button", ariaLabel: "Expand or collapse Episodes" } as const;
      const firstEpisode = { selector: "button", text: "Browser Fixture - 01.mp4" } as const;
      await clickElement(player.view, season);
      await waitForElementHidden(player.view, firstEpisode);
      await clickElement(player.view, season);
      await clickStableElement(player.view, firstEpisode);
      await waitForEpisodeRoute(player.view, COMMON_FIRST_FIXTURE);
      await ensurePlaying(player);
      await setPlaybackRate(player.view, 16);
      const acceleratedStart = await playerState(player.view);
      expect(acceleratedStart).not.toBeNull();
      await waitForPlayerState({
        view: player.view,
        predicate: (state) => state.timelinePosition > (acceleratedStart?.timelinePosition ?? 0) + 2,
        description: "accelerated browser playback to stream two media seconds",
        timeout: 5000,
      });
      await setPlaybackRate(player.view, 1);
      await showPlayerControls(player.view);
      const beforeForward = await playerState(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Forward 10 seconds" });
      const forwarded = await waitForPlayerState({
        view: player.view,
        predicate: (state) => state.timelinePosition >= (beforeForward?.timelinePosition ?? 0) + 8,
        description: "forward ten-second control",
      });
      await showPlayerControls(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Back 10 seconds" });
      await waitForPlayerState({
        view: player.view,
        predicate: (state) => state.timelinePosition <= forwarded.timelinePosition - 8,
        description: "back ten-second control",
      });
      await showPlayerControls(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Next episode" });
      await waitForEpisodeRoute(player.view, COMMON_SECOND_FIXTURE);
      await verifyNoPlayerErrors(player);
      await showPlayerControls(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Previous episode" });
      await waitForEpisodeRoute(player.view, COMMON_FIRST_FIXTURE);
      await verifyNoPlayerErrors(player);
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "common-player-journey", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
    }
  }, 60_000);

  test("marks an episode watched and unwatched durably through the real UI", async () => {
    const runtime = activeHarness();
    const player = await runtime.openApp();
    const watchedName = WATCHED_FIXTURE.split("/").at(-1) ?? "";
    const episodeActions = {
      selector: "summary",
      ariaLabel: "Episode actions",
      ancestorText: watchedName,
    } as const;
    try {
      await clickElement(player.view, { selector: "button", text: "Browser Fixture Show" });
      await clickElement(player.view, episodeActions);
      await clickElement(player.view, { selector: "button[role='menuitem']", text: "Mark as watched" });
      const watchedBadge = { selector: "li span", ancestorText: watchedName, text: "Watched" } as const;
      await waitForElement(player.view, watchedBadge);
      const showUrl = await player.view.evaluate<string>("location.href");
      await player.view.navigate(showUrl);
      await clickElement(player.view, episodeActions);
      await waitForElement(player.view, { selector: "button[role='menuitem']", text: "Mark as unwatched" });
      await clickElement(player.view, { selector: "button[role='menuitem']", text: "Mark as unwatched" });
      await waitForElementHidden(player.view, watchedBadge);
      await player.view.navigate(showUrl);
      await clickElement(player.view, episodeActions);
      expect(await elementVisible(player.view, {
        selector: "button[role='menuitem']",
        text: "Mark as watched",
      })).toBe(true);
    } catch (error: unknown) {
      await captureFailure({ player, name: "watched-durability", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
    }
  }, 30_000);
}

function registerPlaybackRegressionTests(): void {
  test("recovers a transient HLS manifest 404 and plays real generated media", async () => {
    const runtime = activeHarness();
    const player = await runtime.openPlayer(HLS_FAILURE_FIXTURE, { failFirstManifest: true });
    try {
      await verifyNoPlayerErrors(player);
      expect(player.manifestRequests.length).toBeGreaterThanOrEqual(2);
      expect(player.networkResponses.some(({ status, url }) => (
        status === 200 && url.includes("/hls/index")
      ))).toBe(true);
      expect(player.networkResponses.some(({ status, url }) => (
        status === 200 && url.includes("/hls/seg")
      ))).toBe(true);
    } catch (error: unknown) {
      await captureFailure({ player, name: "transient-manifest", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
    }
  }, 60_000);

  test("keeps controls visible during a real timeline drag and settles on the requested HLS seek", async () => {
    const runtime = activeHarness();
    const player = await runtime.openPlayer(HLS_FIXTURE);
    try {
      await verifyNoPlayerErrors(player);
      const bounds = await timelineBounds(player.view);
      const startX = bounds.left + bounds.width * 0.1;
      const targetX = bounds.left + bounds.width * 0.75;
      const y = bounds.top + bounds.height / 2;
      await player.view.cdp("Input.dispatchMouseEvent", {
        type: "mousePressed", x: startX, y, button: "left", clickCount: 1,
      });
      await player.view.cdp("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: targetX, y: y - 180, button: "left", buttons: 1,
      });
      await Bun.sleep(2800);
      const held = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => state.controlsVisible,
          description: "controls to remain visible while timeline pointer capture is held",
          timeout: 2000,
        },
      );
      expect(held.controlsVisible).toBe(true);
      await player.view.cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: targetX, y: y - 180, button: "left", clickCount: 1,
      });
      const target = FIXTURE_DURATION * 0.75;
      const settled = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => Math.abs(state.timelinePosition - target) <= 3 && state.readyState >= 2,
          description: "HLS seek to settle at the requested absolute position",
          timeout: 45_000,
        },
      );
      expect(settled.error).toBeNull();
      await ensurePlaying(player);
      const advanced = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => state.timelinePosition > settled.timelinePosition + 0.75,
          description: "playback to continue after seeking",
        },
      );
      expect(advanced.timelinePosition).toBeGreaterThan(target - 3);
      expect(player.manifestRequests.length).toBeGreaterThanOrEqual(2);
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "timeline-seek", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
    }
  }, 75_000);

  test("direct playback accepts a real range seek and continues advancing", async () => {
    const runtime = activeHarness();
    const player = await runtime.openPlayer(DIRECT_FIXTURE);
    try {
      await verifyNoPlayerErrors(player);
      const bounds = await timelineBounds(player.view);
      await player.view.click(
        bounds.left + bounds.width * 0.65,
        bounds.top + bounds.height / 2,
      );
      const target = FIXTURE_DURATION * 0.65;
      const settled = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => Math.abs(state.timelinePosition - target) <= 2,
          description: "direct video range seek",
        },
      );
      expect(settled.error).toBeNull();
      await ensurePlaying(player);
      const advanced = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => state.timelinePosition > settled.timelinePosition + 0.75,
          description: "direct playback to advance after seeking",
        },
      );
      expect(advanced.error).toBeNull();
      expect(player.networkResponses.some(({ status, url }) => (
        status === 206 && url.includes("/stream")
      ))).toBe(true);
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "direct-seek", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
    }
  }, 45_000);
}

describeBrowser("real browser player harness", () => {
  beforeAll(async () => {
    harness = await startPlayerHarness();
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
    Bun.WebView.closeAll();
  });

  registerCommonJourneyTests();
  registerPlaybackRegressionTests();
});
