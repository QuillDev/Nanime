import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getJson, idAt, startLibraryTestServer, writeLibraryFixture, type LibraryTestServer,
} from "../../server/libraryFilesTestServer.ts";
import { clickElement } from "./browserInteraction.ts";
import {
  actionDisabled, bodyText, clickAction, contents, onDisk, openAdminFiles, openFolder, pickDestination, rowNames,
  screenshot, selectRow, tapElement, typeInto, waitForDialogToClose, waitForRows, waitForToast, waitUntil, type AdminView,
} from "./libraryFilesBrowser.ts";

const describeBrowser = Bun.env["NANIME_LIBRARY_FILES_E2E"] === "true" ? describe : describe.skip;
const EPISODE = "Example Show - 01.mkv";
const SIDECAR = "Example Show - 01.en.ass";
let server: LibraryTestServer | undefined = undefined;
let admin: AdminView | undefined = undefined;

interface ActiveSuite {
  readonly server: LibraryTestServer;
  readonly view: Bun.WebView;
}

function active(): ActiveSuite {
  if (server === undefined || admin === undefined) {
    throw new Error("Library files browser suite did not start");
  }
  return { server, view: admin.view };
}

async function prepareLibrary(media: string): Promise<void> {
  await writeLibraryFixture(media);
  await writeFile(join(media, "Other Show", "Notes.txt"), "other notes");
}

function registerNavigationAndMoveTests(): void {
  test("shows the library root inside the real admin Files tab", async () => {
    const { view } = active();
    await waitForRows(view, ["Example Show", "Incoming", "Other Show", "Seeding Show"]);
    expect(await view.evaluate<string>(`document.querySelector("[role=tab][aria-selected=true]")?.textContent ?? ""`)).toContain("Files");
    await screenshot(view, "01-admin-files-root");
  });

  test("navigates the folder tree into a season", async () => {
    const { view } = active();
    await clickElement(view, { selector: ".nfm-tbody .nfm-row .nfm-name", text: "Example Show" });
    await view.press("Enter");
    await openFolder(view, "Season 1");
    await waitForRows(view, [EPISODE, SIDECAR, "Example Show - 02.mkv"]);
    await screenshot(view, "02-season-1");
  });

  test("moves an episode Season 1 → Misc with its subtitles", async () => {
    const { server: target, view } = active();
    const id = await idAt(target, `Example Show/Season 1/${EPISODE}`);
    await selectRow(view, EPISODE);
    await clickAction(view, "move");
    await pickDestination(view, "Misc");
    await screenshot(view, "03-move-to-misc-preview");
    await clickElement(view, { selector: "[data-testid=move-confirm]" });
    await waitForDialogToClose(view);
    await waitForToast(view, "Moved 1 item to Misc");
    expect(await rowNames(view)).not.toContain(EPISODE);
    expect(await onDisk(target, `Example Show/Misc/${EPISODE}`)).toBe(true);
    expect(await onDisk(target, `Example Show/Misc/${SIDECAR}`)).toBe(true);
    expect(await idAt(target, `Example Show/Misc/${EPISODE}`)).toBe(id);
    await openFolder(view, "Misc");
    await waitForRows(view, [EPISODE, SIDECAR, "Notes.txt"]);
    await screenshot(view, "04-misc-after-move");
  });

  test("moves the same episode Misc → Season 2 and keeps watch progress", async () => {
    const { server: target, view } = active();
    await selectRow(view, EPISODE);
    await clickAction(view, "move");
    await pickDestination(view, "Season 2");
    await clickElement(view, { selector: "[data-testid=move-confirm]" });
    await waitForToast(view, "Moved 1 item to Season 2");
    await openFolder(view, "Season 2");
    await waitForRows(view, [EPISODE, SIDECAR, "Example Show - 03.mkv"]);
    expect(await contents(target, `Example Show/Season 2/${EPISODE}`)).toBe("episode one");
    const progress = await getJson<readonly { readonly rel: string; readonly completed: boolean }[]>(target, "/api/progress");
    expect(progress).toEqual([expect.objectContaining({ rel: `Example Show/Season 2/${EPISODE}`, completed: true })]);
    await screenshot(view, "05-season-2-after-second-move");
  });

  test("renames inline, keeping the extension and renaming the sidecar", async () => {
    const { server: target, view } = active();
    await selectRow(view, EPISODE);
    await clickAction(view, "rename");
    await typeInto(view, { selector: ".nfm-rename-input" }, "Example Show - Pilot");
    await screenshot(view, "06-inline-rename");
    await view.press("Enter");
    await waitForRows(view, ["Example Show - Pilot.mkv", "Example Show - Pilot.en.ass"]);
    expect(await onDisk(target, "Example Show/Season 2/Example Show - Pilot.en.ass")).toBe(true);
    expect(await onDisk(target, `Example Show/Season 2/${SIDECAR}`)).toBe(false);
  });

}

function registerGuardAndRecoveryTests(): void {
  test("refuses a colliding move before sending it and changes nothing", async () => {
    const { server: target, view } = active();
    await openFolder(view, "Other Show");
    await selectRow(view, "Notes.txt");
    await clickAction(view, "move");
    await pickDestination(view, "Misc");
    await waitUntil(view, `document.querySelector(".nfm-preview-row[data-issue=collision]") !== null`, "collision preview");
    expect(await view.evaluate<boolean>(`document.querySelector("[data-testid=move-confirm]").disabled`)).toBe(true);
    await screenshot(view, "07-collision-blocked");
    await view.press("Escape");
    await waitForDialogToClose(view);
    expect(await contents(target, "Other Show/Notes.txt")).toBe("other notes");
    expect(await contents(target, "Example Show/Misc/Notes.txt")).toBe("notes");
  });

  test("filters the whole library by a column value", async () => {
    const { view } = active();
    await clickElement(view, { selector: ".nfm-rail .nfm-tree-row", text: "Library" });
    await clickElement(view, { selector: ".nfm-hfilter", ariaLabel: "Filter Type" });
    await clickElement(view, { selector: ".nfm-popover button", text: "Clear" });
    await clickElement(view, { selector: ".nfm-popover .nfm-filter-option", text: "Subtitles" });
    await waitUntil(view, `[...document.querySelectorAll(".nfm-tbody .nfm-row .nfm-name")].map((node) => node.textContent).join("|") === "Example Show - Pilot.en.ass"`, "subtitle-only results");
    await screenshot(view, "08-type-filter");
    await view.press("Escape");
    await clickElement(view, { selector: ".nfm-link", text: "Clear filters" });
  });

  test("shows server-enforced torrent locks and disables their actions", async () => {
    const { view } = active();
    await openFolder(view, "Seeding Show");
    await selectRow(view, "Seeding Show - 01.mkv");
    expect(await actionDisabled(view, "move")).toBe(true);
    expect(await actionDisabled(view, "rename")).toBe(true);
    expect(await actionDisabled(view, "delete")).toBe(true);
    expect(await bodyText(view, ".nfm-locknote")).toContain("break seeding");
    await screenshot(view, "09-torrent-lock");
    await view.press("Escape");
    await clickElement(view, { selector: ".nfm-rail .nfm-tree-row", text: "Library" });
    await selectRow(view, "Incoming");
    expect(await actionDisabled(view, "move")).toBe(true);
    expect(await bodyText(view, ".nfm-locknote")).toContain("Downloading in qBittorrent (42%)");
    await screenshot(view, "10-ancestor-download-lock");
    await view.press("Escape");
  });

  test("creates a folder at the root and deletes it to trash with a working Undo", async () => {
    const { server: target, view } = active();
    await clickElement(view, { selector: ".nfm-bar button", text: "New folder" });
    await typeInto(view, { selector: "dialog[open] input.nfm-input" }, "Specials");
    await clickElement(view, { selector: "[data-testid=create-confirm]" });
    await waitForRows(view, ["Specials"]);
    expect(await onDisk(target, "Specials")).toBe(true);
    await selectRow(view, "Specials");
    await clickAction(view, "delete");
    await clickElement(view, { selector: "[data-testid=delete-confirm]" });
    await waitForToast(view, "Moved “Specials” to Nanime's trash");
    expect(await onDisk(target, "Specials")).toBe(false);
    await screenshot(view, "11-trash-with-undo");
    await clickElement(view, { selector: ".nfm-toast button", text: "Undo" });
    await waitForToast(view, "Undone");
    await waitForRows(view, ["Specials"]);
    expect(await onDisk(target, "Specials")).toBe(true);
  });

  test("reports a server rejection when the disk changed behind the list", async () => {
    const { server: target, view } = active();
    await rename(join(target.media, "Specials"), join(target.media, "Specials Elsewhere"));
    await selectRow(view, "Specials");
    await clickAction(view, "rename");
    await typeInto(view, { selector: ".nfm-rename-input" }, "Specials 2");
    await view.press("Enter");
    await waitUntil(view, `document.querySelector(".nfm-rename-error")?.textContent?.includes("no longer exists")`, "stale rename error");
    await screenshot(view, "12-stale-rename-error");
    await view.press("Escape");
    expect(await onDisk(target, "Specials 2")).toBe(false);
    await waitForRows(view, ["Specials Elsewhere"]);
  });

  test("pauses every change when qBittorrent ownership can't be read", async () => {
    const { server: target, view } = active();
    target.qbittorrent.setReachable(false);
    await view.navigate(`${target.origin}/admin?tab=files`);
    await waitUntil(view, `document.querySelector("output")?.textContent?.includes("qBittorrent can’t be reached")`, "ownership notice");
    await selectRow(view, "Other Show");
    expect(await actionDisabled(view, "move")).toBe(true);
    await screenshot(view, "13-ownership-unavailable");
    target.qbittorrent.setReachable(true);
    await view.navigate(`${target.origin}/admin?tab=files`);
    await waitForRows(view, ["Other Show"]);
  });

  test("works as a touch layout on a phone-sized viewport", async () => {
    const { server: target } = active();
    const phone = await openAdminFiles(target, { width: 390, height: 844 });
    try {
      const { view } = phone;
      await view.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await waitUntil(view, `document.querySelector(".nfm.nfm--compact") !== null`, "compact layout");
      await tapElement(view, { selector: ".nfm-tbody .nfm-row .nfm-name", text: "Other Show" });
      await waitForRows(view, ["Episode 1.mp4", "Notes.txt"]);
      await screenshot(view, "14-mobile-folder");
      await tapElement(view, { selector: ".nfm-tbody .nfm-row .nfm-name", text: "Episode 1.mp4" });
      await tapElement(view, { selector: ".nfm-mobilebar button[data-action=move]" });
      await pickDestination(view, "Specials Elsewhere");
      const controlsFit = await view.evaluate<boolean>(`[...document.querySelectorAll(".nfm-sheet-foot button")].every((button) => button.getBoundingClientRect().right <= innerWidth && button.scrollWidth <= button.clientWidth)`);
      expect(controlsFit).toBe(true);
      await screenshot(view, "15-mobile-move-sheet");
      await clickElement(view, { selector: "[data-testid=move-confirm]" });
      await waitForToast(view, "Moved 1 item to Specials Elsewhere");
      expect(await onDisk(target, "Specials Elsewhere/Episode 1.mp4")).toBe(true);
      expect(phone.consoleErrors).toEqual([]);
    } finally {
      phone.close();
    }
    expect(admin?.consoleErrors ?? []).toEqual([]);
  });
}

describeBrowser("admin library file manager", () => {
  beforeAll(async () => {
    server = await startLibraryTestServer(prepareLibrary);
    server.qbittorrent.setTorrents([
      { hash: "a".repeat(40), name: "Seeding Show", content: join(server.media, "Seeding Show"), progress: 1 },
      { hash: "b".repeat(40), name: "Partial Show", content: join(server.media, "Incoming", "Partial Show"), progress: 0.42 },
    ]);
    const watched = await server.request("/api/progress/watched", {
      method: "POST", body: JSON.stringify({ rel: `Example Show/Season 1/${EPISODE}`, watched: true }),
    });
    expect(watched.status).toBe(200);
    admin = await openAdminFiles(server, { width: 1280, height: 800 });
  }, 60_000);

  afterAll(async () => {
    admin?.close();
    await server?.close();
  });

  registerNavigationAndMoveTests();
  registerGuardAndRecoveryTests();
});
