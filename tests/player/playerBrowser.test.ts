import { registerManualMetadataTest } from "./manualMetadataBrowser.ts";
import { registerWatchTogetherTests } from "./watchTogetherBrowser.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  activateElement,
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

function testProfile(testName: string): (phase: string) => void {
  const startedAt = performance.now();
  let checkpointAt = startedAt;
  return (phase) => {
    const now = performance.now();
    const phaseDuration = now - checkpointAt;
    const totalDuration = now - startedAt;
    process.stdout.write(
      `[browser-profile] ${testName} | ${phase}: phase=${phaseDuration.toFixed(1)}ms total=${totalDuration.toFixed(1)}ms\n`,
    );
    checkpointAt = now;
  };
}

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

async function verifySkipControls(player: Awaited<ReturnType<PlayerHarness["openPlayer"]>>): Promise<void> {
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
}

async function waitForWatchedMutation(player: Awaited<ReturnType<PlayerHarness["openApp"]>>, count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const completed = player.networkResponses.filter(({ status, url }) => (
      status === 200 && url.includes("/api/progress/watched")
    )).length;
    if (completed >= count) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for watched mutation ${String(count)}`);
}

async function waitForAccountAudioLanguage(
  view: Bun.WebView,
  expected: "en" | "ja" | null,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const language = await view.evaluate<string | null>(
      "fetch('/api/auth/me').then(response => response.json()).then(user => user.preferredAudioLanguage)",
    );
    if (language === expected) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for account audio language: ${String(expected)}`);
}

function registerCommonJourneyTests(): void {
  test("persists Japanese as the account audio default and starts the matching HLS track", async () => {
    const profile = testProfile("account audio preference");
    const runtime = activeHarness();
    const player = await runtime.openApp();
    profile("open application");
    try {
      await player.view.navigate(`${runtime.origin}/profile`);
      await waitForElement(player.view, { selector: "select", ariaLabel: "Default audio language" });
      const changed = await player.view.evaluate<boolean>(`(() => {
        const select = document.querySelector("select[aria-label='Default audio language']");
        if (!(select instanceof HTMLSelectElement)) return false;
        select.value = "ja";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
      expect(changed).toBe(true);
      await waitForAccountAudioLanguage(player.view, "ja");
      profile("save Japanese account preference");

      await player.view.navigate(`${runtime.origin}/profile`);
      await waitForElement(player.view, { selector: "select", ariaLabel: "Default audio language" });
      const persisted = await player.view.evaluate<string>(
        "document.querySelector(\"select[aria-label='Default audio language']\")?.value ?? ''",
      );
      expect(persisted).toBe("ja");
      profile("reload persisted preference");

      const playerUrl = new URL(runtime.origin);
      playerUrl.searchParams.set("episode", HLS_FIXTURE);
      await player.view.navigate(playerUrl.href);
      await verifyNoPlayerErrors(player);
      await showPlayerControls(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Playback settings" });
      await waitForElement(player.view, { selector: "#player-audio-track" });
      const audioLabel = await player.view.evaluate<string>(`(() => {
        const select = document.querySelector("#player-audio-track");
        return select instanceof HTMLSelectElement
          ? select.selectedOptions[0]?.textContent ?? ""
          : "";
      })()`);
      expect(audioLabel.toLowerCase()).toContain("jpn");
      expect(player.manifestRequests.length).toBeGreaterThan(0);
      profile("stream preferred Japanese track");
    } catch (error: unknown) {
      await captureFailure({ player, name: "account-audio-preference", serverLog: runtime.serverLog(), error });
    } finally {
      await player.view.evaluate<number>("fetch('/api/auth/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audioLanguage: null }) }).then(response => response.status)").catch(() => undefined);
      await player.close();
      profile("reset preference and close browser view");
    }
  }, 45_000);

  test("navigates through a season, streams quickly, skips time, and traverses episodes", async () => {
    const profile = testProfile("journey");
    const runtime = activeHarness();
    const player = await runtime.openApp();
    profile("open application");
    try {
      await clickElement(player.view, { selector: "button", text: "Browser Fixture Show" });
      const season = { selector: "button", ariaLabel: "Expand or collapse Episodes" } as const;
      const firstEpisode = { selector: "button", text: "Browser Fixture - 01.mp4" } as const;
      await clickElement(player.view, season);
      await waitForElementHidden(player.view, firstEpisode);
      await clickElement(player.view, season);
      await clickStableElement(player.view, firstEpisode);
      await waitForEpisodeRoute(player.view, COMMON_FIRST_FIXTURE);
      profile("navigate show and season, then open episode");
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
      profile("start and advance accelerated playback");
      await verifySkipControls(player);
      profile("forward and backward controls");
      await showPlayerControls(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Next episode" });
      await waitForEpisodeRoute(player.view, COMMON_SECOND_FIXTURE);
      await verifyNoPlayerErrors(player);
      profile("load and play next episode");
      await showPlayerControls(player.view);
      await clickElement(player.view, { selector: "button", ariaLabel: "Previous episode" });
      await waitForEpisodeRoute(player.view, COMMON_FIRST_FIXTURE);
      await verifyNoPlayerErrors(player);
      profile("load and play previous episode");
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "common-player-journey", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
      profile("close browser view");
    }
  }, 60_000);

  test("marks an episode watched and unwatched durably through the real UI", async () => {
    const profile = testProfile("watched durability");
    const runtime = activeHarness();
    const player = await runtime.openApp();
    profile("open application");
    const watchedName = WATCHED_FIXTURE.split("/").at(-1) ?? "";
    const episodeActions = {
      selector: "summary",
      ariaLabel: "Episode actions",
      ancestorText: watchedName,
    } as const;
    try {
      await clickElement(player.view, { selector: "button", text: "Browser Fixture Show" });
      profile("open show");
      await activateElement(player.view, episodeActions);
      await activateElement(player.view, { selector: "button[role='menuitem']", text: "Mark as watched" });
      await waitForWatchedMutation(player, 1);
      profile("mark watched and persist mutation");
      const showUrl = await player.view.evaluate<string>("location.href");
      await player.view.navigate(showUrl);
      await activateElement(player.view, episodeActions);
      await waitForElement(player.view, { selector: "button[role='menuitem']", text: "Mark as unwatched" });
      profile("reload and verify watched state");
      await activateElement(player.view, { selector: "button[role='menuitem']", text: "Mark as unwatched" });
      await waitForWatchedMutation(player, 2);
      profile("mark unwatched and persist mutation");
      await player.view.navigate(showUrl);
      await activateElement(player.view, episodeActions);
      expect(await elementVisible(player.view, {
        selector: "button[role='menuitem']",
        text: "Mark as watched",
      })).toBe(true);
      profile("reload and verify unwatched state");
    } catch (error: unknown) {
      await captureFailure({ player, name: "watched-durability", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
      profile("close browser view");
    }
  }, 30_000);
}

function registerPlaybackRegressionTests(): void {
  test("recovers a transient HLS manifest 404 and plays real generated media", async () => {
    const profile = testProfile("transient HLS recovery");
    const runtime = activeHarness();
    const player = await runtime.openPlayer(HLS_FAILURE_FIXTURE, { failFirstManifest: true });
    profile("open player and inject manifest failure");
    try {
      await verifyNoPlayerErrors(player);
      profile("recover manifest and advance playback");
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
      profile("validate requests and close browser view");
    }
  }, 60_000);

  test("keeps controls visible during a real timeline drag and settles on the requested HLS seek", async () => {
    const profile = testProfile("timeline HLS seek");
    const runtime = activeHarness();
    const player = await runtime.openPlayer(HLS_FIXTURE);
    profile("open player");
    try {
      await verifyNoPlayerErrors(player);
      profile("load and advance initial playback");
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
      profile("hold vertical timeline drag past dismissal timeout");
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
      profile("release drag and settle HLS seek");
      await ensurePlaying(player);
      const advanced = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => state.timelinePosition > settled.timelinePosition + 0.75,
          description: "playback to continue after seeking",
        },
      );
      profile("resume and advance playback after seek");
      expect(advanced.timelinePosition).toBeGreaterThan(target - 3);
      expect(player.manifestRequests.length).toBeGreaterThanOrEqual(2);
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "timeline-seek", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
      profile("validate state and close browser view");
    }
  }, 75_000);

  test("direct playback accepts a real range seek and continues advancing", async () => {
    const profile = testProfile("direct range seek");
    const runtime = activeHarness();
    const player = await runtime.openPlayer(DIRECT_FIXTURE);
    profile("open player");
    try {
      await verifyNoPlayerErrors(player);
      profile("load and advance initial playback");
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
      profile("issue and settle range seek");
      await ensurePlaying(player);
      const advanced = await waitForPlayerState(
        {
          view: player.view,
          predicate: (state) => state.timelinePosition > settled.timelinePosition + 0.75,
          description: "direct playback to advance after seeking",
        },
      );
      profile("resume and advance playback after seek");
      expect(advanced.error).toBeNull();
      expect(player.networkResponses.some(({ status, url }) => (
        status === 206 && url.includes("/stream")
      ))).toBe(true);
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "direct-seek", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
      profile("validate range response and close browser view");
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
  registerWatchTogetherTests(activeHarness);
  registerManualMetadataTest(activeHarness);
});
