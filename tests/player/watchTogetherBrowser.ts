import { registerPartyLifecycleTests } from "./watchTogetherLifecycleBrowser.ts";
import { registerPartyNavigationTest } from "./partyNavigationBrowser.ts";
import { registerSessionNavigationTest } from "./watchTogetherNavigationBrowser.ts";
import { expect, test } from "bun:test";
import { activateElement, showPlayerControls, waitForElement } from "./browserInteraction.ts";
import { DIRECT_FIXTURE, HLS_FIXTURE } from "./mediaFixture.ts";
import { captureFailure, type PlayerHarness, type PlayerView, playerState, timelineBounds, waitForPlayerState } from "./playerHarness.ts";

export async function startSession(host: PlayerView): Promise<string> {
  await waitForPlayerState({ view: host.view, predicate: (state) => state.readyState >= 2, description: "host ready" });
  await host.view.evaluate("document.querySelector('video').pause()");
  await activateElement(host.view, { selector: "summary", ariaLabel: "Watch together" });
  await activateElement(host.view, { selector: "button", text: "Start watch together" });
  await waitForElement(host.view, { selector: "input[readonly]" });
  return host.view.evaluate<string>("document.querySelector('input[readonly]').value");
}

async function seekHost(host: PlayerView): Promise<void> {
  await showPlayerControls(host.view);
  const bounds = await timelineBounds(host.view);
  const state = await playerState(host.view);
  await host.view.click(bounds.left + bounds.width * 15 / (state?.duration ?? 1), bounds.top + bounds.height / 2);
  await waitForPlayerState({ view: host.view, predicate: (current) => current.readyState >= 2 && Math.abs(current.timelinePosition - 15) < 1.5, description: "host timeline seek" });
  await host.view.evaluate("document.querySelector('video').pause()");
}

async function verifyGuestFollows(host: PlayerView, guest: PlayerView): Promise<void> {
  await waitForPlayerState({ view: guest.view, predicate: (state) => state.readyState >= 2 && state.paused, description: "guest joined paused host" });
  await seekHost(host);
  await waitForPlayerState({ view: guest.view, predicate: (state) => state.paused && Math.abs(state.timelinePosition - 15) < 1.5, description: "guest follows host seek" });
  await host.view.evaluate("document.querySelector('video').play()");
  await waitForPlayerState({ view: guest.view, predicate: (state) => !state.paused && state.timelinePosition > 16, description: "guest follows host play" });
  await host.view.evaluate("document.querySelector('video').pause()");
  const paused = await waitForPlayerState({ view: guest.view, predicate: (state) => state.paused, description: "guest follows host pause" });
  const hostState = await playerState(host.view);
  expect(Math.abs(paused.timelinePosition - (hostState?.timelinePosition ?? 0))).toBeLessThan(1.75);
  await guest.view.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  const afterGuestSeek = await playerState(guest.view);
  expect(afterGuestSeek?.timelinePosition).toBeCloseTo(paused.timelinePosition, 0);
  await activateElement(host.view, { selector: "button", text: "End session" });
  await activateElement(guest.view, { selector: "summary", ariaLabel: "Watch together" });
  await waitForElement(guest.view, { selector: "[role=alert]" });
  const ended = await playerState(guest.view);
  expect(ended?.paused).toBe(true);
  await activateElement(guest.view, { selector: "button", text: "Leave session" });
  expect(await guest.view.evaluate<boolean>("new URL(location.href).searchParams.has('watch')")).toBe(false);
}

export function registerWatchTogetherTests(activeHarness: () => PlayerHarness): void {
  registerPartyNavigationTest(activeHarness);
  registerSessionNavigationTest(activeHarness, startSession);
  registerPartyLifecycleTests(activeHarness, startSession);
  for (const rel of [DIRECT_FIXTURE, HLS_FIXTURE]) {
    test(`watch together synchronizes two browsers: ${rel}`, async () => {
      const runtime = activeHarness();
      const host = await runtime.openPlayer(rel);
      let guest: PlayerView | undefined = undefined;
      try {
        const invite = await startSession(host);
        guest = await runtime.openApp();
        await guest.view.navigate(invite);
        await verifyGuestFollows(host, guest);
        expect(host.consoleErrors).toEqual([]);
        expect(guest.consoleErrors).toEqual([]);
      } catch (error: unknown) {
        await captureFailure({ player: guest ?? host, name: "watch-together", serverLog: runtime.serverLog(), error });
      } finally {
        await guest?.close();
        await host.close();
      }
    }, 60_000);
  }
}
