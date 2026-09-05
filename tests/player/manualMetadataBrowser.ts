import { expect, test } from "bun:test";
import { activateElement, waitForElement } from "./browserInteraction.ts";
import { FIXTURE_FOLDER } from "./mediaFixture.ts";
import { captureFailure, type PlayerHarness } from "./playerHarness.ts";

export function registerManualMetadataTest(runtime: () => PlayerHarness): void {
  test("manual metadata linking succeeds when provider searches are blocked", async () => {
    const harness = runtime();
    const player = await harness.openApp();
    try {
      await player.view.cdp("Network.setBlockedURLs", { urls: ["*/api/anilist/search*", "*/api/jikan/search*"] });
      await activateElement(player.view, { selector: "button", text: FIXTURE_FOLDER });
      await activateElement(player.view, { selector: "button", ariaLabel: "Change metadata match" });
      await activateElement(player.view, { selector: "summary", text: "Link manually" });
      await player.view.evaluate(`(() => {
        const input = document.querySelector('input[type="number"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '123');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await activateElement(player.view, { selector: "button", text: "Save manual mapping" });
      await waitForElement(player.view, { selector: 'a[href="https://anilist.co/anime/123"]' });
      expect(await player.view.evaluate<boolean>("document.querySelector('[role=dialog]') === null")).toBe(true);
    } catch (error: unknown) {
      await captureFailure({ player, name: "manual-metadata", serverLog: harness.serverLog(), error });
    } finally { await player.close(); }
  }, 60_000);
}
