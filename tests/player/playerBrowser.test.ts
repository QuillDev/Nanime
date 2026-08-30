import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  captureFailure,
  DIRECT_FIXTURE,
  FIXTURE_DURATION,
  HLS_FIXTURE,
  type PlayerHarness,
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

describeBrowser("real browser player harness", () => {
  beforeAll(async () => {
    harness = await startPlayerHarness();
  }, 120_000);

  afterAll(async () => {
    await harness?.close();
    Bun.WebView.closeAll();
  });

  test("recovers a transient HLS manifest 404 and plays real generated media", async () => {
    const runtime = activeHarness();
    const player = await runtime.openPlayer(HLS_FIXTURE, { failFirstManifest: true });
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
});
