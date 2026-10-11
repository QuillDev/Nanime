import { describe, expect, test } from "bun:test";
import { click, downloadSelected, results, runFixture, screenshot, type TorrentFixture, waitFor } from "./searchHarness.ts";

const browserTests = Bun.env["NANIME_NYAA_E2E"] === "true" ? describe : describe.skip;

async function selectAndSubmit(view: Bun.WebView): Promise<void> {
  await click(view, "Select Fixture 1");
  await click(view, "Select Fixture 2");
  expect(await view.evaluate<string>('document.querySelector("output").textContent')).toContain("2 selected");
  await screenshot(view, "selection");
  await downloadSelected(view);
  expect(await view.evaluate<boolean>('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Download selected")).disabled')).toBe(true);
  await screenshot(view, "in-progress");
  await downloadSelected(view);
  await waitFor(view, 'document.body.textContent.includes("Added to qBittorrent.") && document.body.textContent.includes("Fixture provider unavailable")');
}

async function verifyPartialFailure(view: Bun.WebView, provider: TorrentFixture): Promise<void> {
  expect(provider.added).toEqual([{ magnet: results[0]?.magnet ?? "", showFolder: "Fixture Show" }]);
  expect(await view.evaluate<boolean>('document.querySelector(`[aria-label="Download Fixture 1"]`).disabled')).toBe(true);
  expect(await view.evaluate<boolean>('document.querySelector(`[aria-label="Select Fixture 2"]`).checked')).toBe(true);
  expect(await view.evaluate<string>('document.querySelector("output").textContent')).toContain("1 selected");
  await screenshot(view, "partial-failure");
}

async function retryFailure(view: Bun.WebView, provider: TorrentFixture): Promise<void> {
  provider.rejectSecond = false;
  await downloadSelected(view);
  await waitFor(view, 'document.querySelector("output").textContent.includes("0 selected")');
  expect(provider.added).toEqual([1, 2].map((id) => ({ magnet: results[id - 1]?.magnet ?? "", showFolder: "Fixture Show" })));
  await screenshot(view, "retry-success");
}

async function downloadRemaining(view: Bun.WebView, provider: TorrentFixture): Promise<void> {
  await click(view, "Select all available results");
  expect(await view.evaluate<string>('document.querySelector("output").textContent')).toContain("3 selected");
  await downloadSelected(view);
  await waitFor(view, 'document.querySelector("output").textContent.includes("0 selected")');
  expect(provider.added.length).toBe(5);
  expect(new Set(provider.added.map((item) => item.magnet)).size).toBe(5);
  expect(provider.maximumActive).toBeLessThanOrEqual(3);
}

browserTests("Nyaa downloads in the real search dialog", () => {
  test("selected torrents show individual outcomes and retry only failures at the chosen destination", async () => {
    await runFixture(async (view, provider) => {
      await selectAndSubmit(view);
      await verifyPartialFailure(view, provider);
      await retryFailure(view, provider);
      await downloadRemaining(view, provider);
    });
  }, 30_000);

  test("a larger batch queues every selected torrent with at most three simultaneous adds", async () => {
    await runFixture(async (view, provider) => {
      provider.rejectSecond = false;
      await click(view, "Select all available results");
      await downloadSelected(view);
      await waitFor(view, 'document.querySelector("output").textContent.includes("0 selected")');
      expect(new Set(provider.added.map((item) => item.magnet))).toEqual(new Set(results.map((result) => result.magnet)));
      expect(provider.maximumActive).toBeLessThanOrEqual(3);
    });
  }, 30_000);

  test("selection clears when sorting or reopening results", async () => {
    await runFixture(async (view, provider) => {
      await click(view, "Select Fixture 1");
      expect(await view.evaluate<string>('document.querySelector("output").textContent')).toContain("1 selected");
      await view.evaluate('(() => { const select = document.querySelector("select"); select.value = "seeders"; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
      await waitFor(view, 'document.querySelector("output").textContent.includes("0 selected")');
      await click(view, "Select Fixture 2");
      await view.evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Close").click()');
      await view.evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Open results").click()');
      await waitFor(view, 'document.querySelector("output")?.textContent.includes("0 selected")');
      expect(await view.evaluate<boolean>('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Download selected")).disabled')).toBe(true);
      expect(provider.added).toEqual([]);
    });
  }, 30_000);

  test("select all can be cleared and single downloads remain available without submitting other rows", async () => {
    await runFixture(async (view, provider) => {
      await click(view, "Select all available results");
      expect(await view.evaluate<string>('document.querySelector("output").textContent')).toContain("5 selected");
      await click(view, "Select all available results");
      expect(await view.evaluate<string>('document.querySelector("output").textContent')).toContain("0 selected");
      await click(view, "Download Fixture 3");
      await waitFor(view, 'document.body.textContent.includes("Added to qBittorrent.")');
      expect(provider.added).toEqual([{ magnet: results[2]?.magnet ?? "", showFolder: "Fixture Show" }]);
    });
  }, 30_000);
});
