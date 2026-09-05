import { expect, test } from "bun:test";
import { activateElement, waitForElement } from "./browserInteraction.ts";
import { SECOND_FIXTURE_FOLDER } from "./mediaFixture.ts";
import { captureFailure, type PlayerHarness, type PlayerView, waitForPlayerState } from "./playerHarness.ts";

async function removeGuest(host: PlayerView, guest: PlayerView): Promise<void> {
  await activateElement(host.view, { selector: "button", text: "Close" });
  await activateElement(host.view, { selector: "button", ariaLabel: "Party" });
  await activateElement(guest.view, { selector: "button", ariaLabel: "Party" });
  await waitForElement(guest.view, { selector: "p", text: "Waiting for the host" });
  expect(await guest.view.evaluate<number>("document.querySelectorAll('[popover] button[aria-label^=\"Remove \"]').length")).toBe(0);
  await activateElement(host.view, { selector: "button", text: "Remove" });
  await waitForElement(host.view, { selector: "p", text: "1 in party" });
  await waitForElement(guest.view, { selector: "[popover] [role=alert]" });
  const url = await guest.view.evaluate<string>("location.href");
  await guest.view.navigate(url);
  await activateElement(guest.view, { selector: "button", ariaLabel: "Party" });
  await waitForElement(guest.view, { selector: "[popover] [role=alert]" });
}

export function registerPartyNavigationTest(runtime: () => PlayerHarness): void {
  test("navigation creates an empty party and joins an invite before watching", async () => {
    const harness = runtime();
    const host = await harness.openApp();
    const guest = await harness.openApp();
    try {
      await activateElement(host.view, { selector: "button", ariaLabel: "Party" });
      await activateElement(host.view, { selector: "button", text: "Create party" });
      await waitForElement(host.view, { selector: "p", text: "You control this session" });
      await waitForElement(host.view, { selector: "p", text: "Choose an episode" });
      const invite = await host.view.evaluate<string>("document.querySelector('input[readonly]').value");
      await activateElement(host.view, { selector: "button", text: "Copy invite link" });
      await waitForElement(host.view, { selector: "output" });
      await activateElement(guest.view, { selector: "button", ariaLabel: "Party" });
      await guest.view.evaluate(`(() => {
        const input = document.querySelector('input[placeholder="Paste an invite link"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(invite)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await activateElement(guest.view, { selector: "button", text: "Join party" });
      await waitForElement(host.view, { selector: "p", text: "2 in party" });
      expect(await host.view.evaluate<number>("document.querySelectorAll('[role=dialog]').length")).toBe(0);
      expect(await host.view.evaluate<number>("document.querySelectorAll('[aria-label=\"Party members\"] li').length")).toBe(2);
      await activateElement(host.view, { selector: "button", text: "Close" });
      await activateElement(host.view, { selector: "button", text: SECOND_FIXTURE_FOLDER });
      await activateElement(host.view, { selector: "button", text: "Another Fixture - 01.mp4" });
      await waitForPlayerState({ view: guest.view, predicate: (state) => state.readyState >= 2, description: "nav party follows first episode" });
      await removeGuest(host, guest);
      expect(host.consoleErrors).toEqual([]);
      expect(guest.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player: guest, name: "party-navigation", serverLog: harness.serverLog(), error });
    } finally { await guest.close(); await host.close(); }
  }, 60_000);
}
