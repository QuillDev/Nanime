// Real-browser helpers for the admin library file manager. They drive the
// production build through visible elements and read outcomes from the page
// and from the isolated library on disk.
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LibraryTestServer } from "../../server/libraryFilesTestServer.ts";
import { clickElement, waitForElement, type ElementTarget } from "./browserInteraction.ts";
import { browserBackend, requiredExecutable } from "./playerHarness.ts";

const SCREENSHOT_DIRECTORY = Bun.env["NANIME_LIBRARY_FILES_SCREENSHOTS"] ?? join(process.cwd(), "test-results", "library-files");

export interface AdminView {
  readonly view: Bun.WebView;
  readonly consoleErrors: string[];
  close: () => void;
}

export async function openAdminFiles(server: LibraryTestServer, size: { readonly width: number; readonly height: number }): Promise<AdminView> {
  const browserPath = requiredExecutable(["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]);
  const consoleErrors: string[] = [];
  const view = new Bun.WebView({
    width: size.width,
    height: size.height,
    backend: browserBackend(browserPath),
    console: (type: string, ...values: unknown[]) => {
      if (type === "error") {
        consoleErrors.push(values.map(String).join(" "));
      }
    },
  });
  await view.navigate(server.origin);
  const status = await view.evaluate<number>(`fetch("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "library-files-test-admin-password" }),
  }).then((response) => response.status)`);
  if (status !== 200) {
    view.close();
    throw new Error(`Browser login failed (${String(status)})`);
  }
  await view.navigate(`${server.origin}/admin?tab=files`);
  await waitForElement(view, { selector: ".nfm .nfm-row" }, 20_000);
  return { view, consoleErrors, close: () => view.close() };
}

export async function waitUntil(view: Bun.WebView, expression: string, description: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) {
      return;
    }
    await Bun.sleep(50);
  }
  await screenshot(view, "failure");
  const visibleState = await bodyText(view, ".nfm");
  throw new Error(`Timed out waiting for ${description}. Visible manager state: ${visibleState}`);
}

export function rowNames(view: Bun.WebView): Promise<readonly string[]> {
  return view.evaluate<readonly string[]>(`[...document.querySelectorAll(".nfm-tbody .nfm-row .nfm-name")].map((node) => node.textContent)`);
}

export function bodyText(view: Bun.WebView, selector: string): Promise<string> {
  return view.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
}

export async function waitForRows(view: Bun.WebView, names: readonly string[]): Promise<void> {
  const expected = JSON.stringify(names);
  await waitUntil(view, `(() => { const names = [...document.querySelectorAll(".nfm-tbody .nfm-row .nfm-name")].map((node) => node.textContent); return ${expected}.every((name) => names.includes(name)); })()`, `rows ${expected}`);
}

export async function openFolder(view: Bun.WebView, name: string): Promise<void> {
  await clickElement(view, { selector: ".nfm-rail .nfm-tree-row", text: name });
  await waitUntil(view, `document.querySelector(".nfm-rail .nfm-tree-line[data-current] .nfm-tree-name")?.textContent === ${JSON.stringify(name)}`, `current folder ${name}`);
}

export async function selectRow(view: Bun.WebView, name: string): Promise<void> {
  await clickElement(view, { selector: ".nfm-tbody input[type=checkbox]", ariaLabel: `Select ${name}` });
}

export async function clickAction(view: Bun.WebView, action: "delete" | "move" | "rename"): Promise<void> {
  await clickElement(view, { selector: `button[data-action=${action}]` });
}

export function actionDisabled(view: Bun.WebView, action: "delete" | "move" | "rename"): Promise<boolean> {
  return view.evaluate<boolean>(`document.querySelector("button[data-action=${action}]")?.disabled === true`);
}

export async function pickDestination(view: Bun.WebView, name: string): Promise<void> {
  await clickElement(view, { selector: "dialog[open] input[type=search]" });
  await view.type(name);
  await clickElement(view, { selector: "dialog[open] .nfm-dest", text: name });
}

export async function tapElement(view: Bun.WebView, target: ElementTarget): Promise<void> {
  const point = await waitForElement(view, target);
  await view.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
  await view.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export async function typeInto(view: Bun.WebView, target: ElementTarget, text: string): Promise<void> {
  await clickElement(view, target);
  // Virtual Home/End chords select the complete field in the Chrome backend.
  await view.press("Home");
  await view.press("End", { modifiers: ["Shift"] });
  await view.type(text);
}

export async function waitForToast(view: Bun.WebView, text: string): Promise<void> {
  await waitUntil(view, `document.querySelector(".nfm-toast")?.textContent?.includes(${JSON.stringify(text)})`, `toast "${text}"`);
}

export async function waitForDialogToClose(view: Bun.WebView): Promise<void> {
  await waitUntil(view, `document.querySelector("dialog[open]") === null`, "dialog to close");
}

export async function screenshot(view: Bun.WebView, name: string): Promise<string> {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
  const path = join(SCREENSHOT_DIRECTORY, `${name}.png`);
  await Bun.write(path, await view.screenshot({ format: "png" }));
  return path;
}

export async function onDisk(server: LibraryTestServer, path: string): Promise<boolean> {
  return await lstat(join(server.media, ...path.split("/"))).catch(() => null) !== null;
}

export function contents(server: LibraryTestServer, path: string): Promise<string> {
  return readFile(join(server.media, ...path.split("/")), "utf8");
}
