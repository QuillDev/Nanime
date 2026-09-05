import { expect, test } from "bun:test";
import { HLS_FIXTURE } from "./mediaFixture.ts";
import {
  captureFailure,
  type PlayerHarness,
  playerState,
  waitForPlayerState,
} from "./playerHarness.ts";

type Player = Awaited<ReturnType<PlayerHarness["openPlayer"]>>;

async function simulateExpiredBackground(view: Bun.WebView): Promise<void> {
  await view.evaluate(`(() => {
    const actualNow = Date.now;
    const hiddenAt = actualNow();
    let visibility = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Date.now = () => hiddenAt + 61_000;
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    Date.now = actualNow;
    Reflect.deleteProperty(document, "visibilityState");
  })()`);
}

export function registerBackgroundRecoveryTest(
  activeHarness: () => PlayerHarness,
  verifyNoPlayerErrors: (player: Player) => Promise<void>,
): void {
  test("renews HLS playback after a background interval can expire its lease", async () => {
    const runtime = activeHarness();
    const player = await runtime.openPlayer(HLS_FIXTURE);
    try {
      await verifyNoPlayerErrors(player);
      const before = await playerState(player.view);
      expect(before).not.toBeNull();
      const manifestCount = player.manifestRequests.length;
      await simulateExpiredBackground(player.view);
      const recovered = await waitForPlayerState({
        view: player.view,
        predicate: (state) => state.timelinePosition > (before?.timelinePosition ?? 0) + 0.5,
        description: "playback to advance after foreground recovery",
      });
      expect(recovered.error).toBeNull();
      expect(player.manifestRequests.length).toBeGreaterThan(manifestCount);
      expect(player.consoleErrors).toEqual([]);
    } catch (error: unknown) {
      await captureFailure({ player, name: "background-recovery", serverLog: runtime.serverLog(), error });
    } finally {
      await player.close();
    }
  }, 60_000);
}
