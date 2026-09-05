import { expect, test } from "bun:test";
import { activateElement, showPlayerControls, waitForElement } from "./browserInteraction.ts";
import { COMMON_FIRST_FIXTURE, COMMON_SECOND_FIXTURE, OTHER_SHOW_FIXTURE, SECOND_FIXTURE_FOLDER } from "./mediaFixture.ts";
import { captureFailure, type PlayerHarness, type PlayerView, waitForPlayerState } from "./playerHarness.ts";

async function waitForEpisode(player: PlayerView, rel: string | null): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const actual = await player.view.evaluate<string | null>("new URL(location.href).searchParams.get('episode')");
    if (actual === rel) { return; }
    await Bun.sleep(50);
  }
  throw new Error(`Guest did not follow session selection: ${String(rel)}`);
}

async function nextAndBrowse(host: PlayerView, guest: PlayerView): Promise<void> {
  await showPlayerControls(host.view);
  await activateElement(host.view, { selector: "button", ariaLabel: "Next episode" });
  await waitForEpisode(guest, COMMON_SECOND_FIXTURE);
  await waitForPlayerState({ view: guest.view, predicate: (state) => state.readyState >= 2, description: "guest loads next episode" });
  await activateElement(host.view, { selector: "button", text: "Close" });
  await waitForEpisode(guest, null);
  await activateElement(guest.view, { selector: "button", ariaLabel: "Party" });
  await waitForElement(guest.view, { selector: "p", text: "Waiting for the host" });
  await activateElement(guest.view, { selector: "button", text: "Close" });
  await activateElement(host.view, { selector: "button", text: SECOND_FIXTURE_FOLDER });
  await activateElement(host.view, { selector: "button", text: "Another Fixture - 01.mp4" });
  await waitForEpisode(guest, OTHER_SHOW_FIXTURE);
  await waitForPlayerState({ view: guest.view, predicate: (state) => state.readyState >= 2, description: "guest loads another show" });
}

async function verifyLateJoinAndLeave(host: PlayerView, guest: PlayerView, invite: string): Promise<void> {
  await guest.view.navigate(invite);
  await waitForEpisode(guest, OTHER_SHOW_FIXTURE);
  await waitForPlayerState({ view: guest.view, predicate: (state) => state.readyState >= 2, description: "original invite joins current selection" });
  await activateElement(guest.view, { selector: "summary", ariaLabel: "Watch together" });
  await activateElement(guest.view, { selector: "button", text: "Leave session" });
  await activateElement(host.view, { selector: "button", text: "Close" });
  await activateElement(host.view, { selector: "button", ariaLabel: "Party" });
  await waitForElement(host.view, { selector: "input[readonly]" });
  expect(await host.view.evaluate<string>("document.querySelector('input[readonly]').value")).toBe(invite);
  await activateElement(host.view, { selector: "button", text: "End session" });
  expect(await guest.view.evaluate<string | null>("new URL(location.href).searchParams.get('episode')")).toBe(OTHER_SHOW_FIXTURE);
  expect(await guest.view.evaluate<boolean>("new URL(location.href).searchParams.has('watch')")).toBe(false);
}

export function registerSessionNavigationTest(
  activeHarness: () => PlayerHarness,
  startSession: (host: PlayerView) => Promise<string>,
): void {
  test("one invitation follows episodes, browsing and another show until the guest leaves", async () => {
    const runtime = activeHarness();
    const host = await runtime.openPlayer(COMMON_FIRST_FIXTURE);
    let guest: PlayerView | undefined = undefined;
    try {
      const invite = await startSession(host);
      expect(new URL(invite).searchParams.has("episode")).toBe(false);
      guest = await runtime.openApp();
      await guest.view.navigate(invite);
      await waitForEpisode(guest, COMMON_FIRST_FIXTURE);
      await nextAndBrowse(host, guest);
      await verifyLateJoinAndLeave(host, guest, invite);
      expect(host.consoleErrors).toEqual([]);
      expect(guest.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player: guest ?? host, name: "watch-together-navigation", serverLog: runtime.serverLog(), error });
    } finally {
      await guest?.close();
      await host.close();
    }
  }, 60_000);
}
