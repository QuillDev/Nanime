import { expect, test } from "bun:test";
import { activateElement, waitForElement } from "./browserInteraction.ts";
import { DIRECT_FIXTURE } from "./mediaFixture.ts";
import { captureFailure, type PlayerHarness, type PlayerView, waitForPlayerState } from "./playerHarness.ts";

type StartSession = (host: PlayerView) => Promise<string>;

async function join(runtime: PlayerHarness, invite: string): Promise<PlayerView> {
  const guest = await runtime.openApp();
  await guest.view.navigate(invite);
  await waitForPlayerState({ view: guest.view, predicate: (state) => state.readyState >= 2, description: "party member loads playback" });
  await activateElement(guest.view, { selector: "summary", ariaLabel: "Watch together" });
  return guest;
}
async function refreshMember(player: PlayerView, host: boolean): Promise<void> {
  const url = await player.view.evaluate<string>("location.href");
  await player.view.navigate(url);
  await waitForPlayerState({ view: player.view, predicate: (state) => state.readyState >= 2, description: "refreshed party player loads" });
  await activateElement(player.view, { selector: "summary", ariaLabel: "Watch together" });
  await waitForElement(player.view, { selector: "p", text: host ? "You control this session" : "Following the host" });
  await waitForElement(player.view, { selector: "p", text: "2 in party" });
}
async function verifyRefreshAndLeave(host: PlayerView, guest: PlayerView, invite: string): Promise<void> {
  await host.view.evaluate("document.querySelector('video').currentTime = 15");
  await waitForPlayerState({ view: guest.view, predicate: (state) => Math.abs(state.timelinePosition - 15) < 1.5, description: "party position before refresh" });
  await refreshMember(guest, false);
  await refreshMember(host, true);
  await waitForPlayerState({ view: host.view, predicate: (state) => state.paused && Math.abs(state.timelinePosition - 15) < 1.5, description: "host restores shared position" });
  expect(await host.view.evaluate<string>("document.querySelector('input[readonly]').value")).toBe(invite);
  await activateElement(host.view, { selector: "button", text: "Leave session" });
  await waitForElement(guest.view, { selector: "p", text: "You control this session" });
  expect(await guest.view.evaluate<string>("document.querySelector('input[readonly]').value")).toBe(invite);
  await guest.view.evaluate("document.querySelector('video').play()");
  await waitForPlayerState({ view: guest.view, predicate: (state) => !state.paused && state.timelinePosition > 16, description: "promoted host controls playback" });
  await activateElement(guest.view, { selector: "button", text: "End session" });
}
function refreshTest(runtime: () => PlayerHarness, start: StartSession): void {
  test("host and guest refresh retain membership and leaving promotes the guest", async () => {
    const harness = runtime();
    const host = await harness.openPlayer(DIRECT_FIXTURE);
    let guest: PlayerView | undefined = undefined;
    try {
      const invite = await start(host);
      guest = await join(harness, invite);
      await verifyRefreshAndLeave(host, guest, invite);
      expect(host.consoleErrors).toEqual([]);
      expect(guest.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player: guest ?? host, name: "party-refresh", serverLog: harness.serverLog(), error });
    } finally { await guest?.close(); await host.close(); }
  }, 60_000);
}
function disconnectTest(runtime: () => PlayerHarness, start: StartSession): void {
  test("closing the host promotes only the oldest connected guest after the grace period", async () => {
    const harness = runtime();
    const host = await harness.openPlayer(DIRECT_FIXTURE);
    const guests: PlayerView[] = [];
    try {
      const invite = await start(host);
      const first = await join(harness, invite);
      guests.push(first);
      const second = await join(harness, invite);
      guests.push(second);
      await waitForElement(second.view, { selector: "p", text: "3 in party" });
      await host.close();
      await waitForElement(first.view, { selector: "p", text: "You control this session" }, 45_000);
      expect(await second.view.evaluate<boolean>("Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'End session')")).toBe(false);
      await activateElement(first.view, { selector: "button", text: "End session" });
      await waitForElement(second.view, { selector: "[role=alert]" });
    } catch (error: unknown) {
      await captureFailure({ player: guests[0] ?? host, name: "party-disconnect", serverLog: harness.serverLog(), error });
    } finally {
      for (const guest of guests) { await guest.close(); }
      await host.close();
    }
  }, 75_000);
}
export function registerPartyLifecycleTests(runtime: () => PlayerHarness, start: StartSession): void {
  refreshTest(runtime, start);
  disconnectTest(runtime, start);
}
