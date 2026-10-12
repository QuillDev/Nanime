import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startLibraryTestServer, type LibraryTestServer } from "../../server/libraryFilesTestServer.ts";
import { clickElement } from "./browserInteraction.ts";
import { openAdminFiles, screenshot, tapElement, waitUntil } from "./libraryFilesBrowser.ts";

const describeBrowser = Bun.env["NANIME_LIBRARY_FILES_E2E"] === "true" ? describe : describe.skip;
let server: LibraryTestServer | undefined = undefined;

// Measure the painted text, not just the button's scrollWidth: a flex item's
// label can spill outside its selected background without creating overflow.
const LABELS_FIT = `(() => {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  return tabs.length === 5 && tabs.every((tab) => {
    const button = tab.getBoundingClientRect();
    const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      if (label.left < button.left || label.right > button.right || label.top < button.top || label.bottom > button.bottom) return false;
    }
    return true;
  }) && document.documentElement.scrollWidth <= innerWidth;
})()`;

function activeServer(): LibraryTestServer {
  if (server === undefined) {throw new Error("Admin navigation test server did not start");}
  return server;
}

describeBrowser("admin navigation", () => {
  beforeAll(async () => { server = await startLibraryTestServer(); }, 60_000);
  afterAll(async () => { await server?.close(); });

  test.each([
    { tab: "Files", label: "About library files", copy: "Watch progress, history, and mappings follow moved media" },
    { tab: "Videos", label: "About Video management", copy: "Select shows, seasons, or individual episodes" },
  ])("keeps $tab explanations behind its help control", async ({ tab, label, copy }) => {
    const admin = await openAdminFiles(activeServer(), { width: 390, height: 844 });
    try {
      await clickElement(admin.view, { selector: "[role=tab]", text: tab });
      const explanationVisible = (): Promise<boolean> => admin.view.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(copy)})`);
      expect(await explanationVisible()).toBe(false);
      await clickElement(admin.view, { selector: "summary", ariaLabel: label });
      expect(await explanationVisible()).toBe(true);
      await screenshot(admin.view, `admin-mobile-${tab.toLowerCase()}-help`);
      await clickElement(admin.view, { selector: "summary", ariaLabel: label });
      expect(await explanationVisible()).toBe(false);
    } finally {
      admin.close();
    }
  });

  test.each([320, 375, 390, 768, 1280])("keeps every tab label inside its selected background at %ipx", async (width) => {
    const admin = await openAdminFiles(activeServer(), { width, height: 844 });
    try {
      if (width === 390) {await admin.view.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });}
      const selectTab = width === 390 ? tapElement : clickElement;
      for (const label of ["Download", "Files", "Videos", "Users", "System"]) {
        await selectTab(admin.view, { selector: "[role=tab]", text: label });
        await waitUntil(admin.view, `document.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim() === ${JSON.stringify(label)}`, `${label} selected`);
        if (width === 390) {await screenshot(admin.view, `admin-mobile-${label.toLowerCase()}`);}
        expect(await admin.view.evaluate<boolean>(LABELS_FIT)).toBe(true);
      }
      expect(admin.consoleErrors).toEqual([]);
    } finally {
      admin.close();
    }
  });
});
