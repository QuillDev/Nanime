import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const browserSuite = Bun.env["NANIME_FILE_MANAGER_E2E"] === "true" ? describe : describe.skip;
const DIST = join(import.meta.dir, "../demo/dist");
const PILOT_ID = "hz-s2-e01";
const PILOT_NAME = "Hoshizora Relay - S02E01 - Reboot.mkv";
let server: Bun.Server<undefined> | undefined = undefined;
let activeView: Bun.WebView | undefined = undefined;

interface Point { readonly x: number; readonly y: number }

async function waitFor(view: Bun.WebView, expression: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await view.evaluate<boolean>(`Boolean(${expression})`)) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error(`Package UI did not reach: ${expression}`);
}

async function pointFor(view: Bun.WebView, selector: string): Promise<Point> {
  await waitFor(view, `document.querySelector(${JSON.stringify(selector)}) !== null`);
  return await view.evaluate<Point>(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    node.scrollIntoView({ block: "nearest" });
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
}

async function click(view: Bun.WebView, selector: string): Promise<void> {
  const point = await pointFor(view, selector);
  await view.click(point.x, point.y);
}

async function clickText(view: Bun.WebView, selector: string, text: string): Promise<void> {
  const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(text)})`;
  await waitFor(view, `${expression} !== undefined`);
  const point = await view.evaluate<Point>(`(() => {
    const node = ${expression};
    node.scrollIntoView({ block: "nearest" });
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await view.click(point.x, point.y);
}

async function open(options: { readonly query?: string; readonly width?: number } = {}): Promise<Bun.WebView> {
  if (server === undefined) {
    throw new Error("Package fixture server did not start");
  }
  const path = Bun.which("google-chrome-stable") ?? Bun.which("google-chrome") ?? Bun.which("chromium");
  if (path === null) {
    throw new Error("Package browser tests require Chrome or Chromium on PATH");
  }
  const url = Bun.env["NANIME_CHROME_URL"];
  activeView = new Bun.WebView({
    width: options.width ?? 1280,
    height: 850,
    backend: url === undefined || url === "" ? { type: "chrome", path, argv: ["--no-sandbox"] } : { type: "chrome", url },
  });
  await activeView.navigate(`http://127.0.0.1:${String(server.port)}/?latency=0&${options.query ?? ""}`);
  await waitFor(activeView, "document.querySelector('.nfm-tbody .nfm-row') !== null");
  return activeView;
}

async function movePilot(view: Bun.WebView): Promise<void> {
  await click(view, `[data-nfm-id="${PILOT_ID}"] input[type=checkbox]`);
  await click(view, "button[data-action=move]");
  await waitFor(view, "document.querySelector('dialog[open] input[type=search]') !== null");
  await view.type("Misc");
  expect(await view.evaluate<string>("document.querySelector('dialog[open] input[type=search]').value")).toBe("Misc");
  await clickText(view, ".nfm-dest-name > span:first-child", "Misc");
  await click(view, "[data-testid=move-confirm]");
  await waitFor(view, "document.querySelector('.nfm-toast')?.textContent.includes('Moved')");
  await clickText(view, ".nfm-toast button", "Open");
  await waitFor(view, `document.querySelector('.nfm-tbody [data-nfm-id="${PILOT_ID}"] .nfm-name')?.textContent === ${JSON.stringify(PILOT_NAME)}`);
}

async function saveScreenshot(view: Bun.WebView, name: string): Promise<void> {
  const directory = join(process.cwd(), "test-results", "file-manager-package");
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, `${name}.png`), await view.screenshot({ format: "png" }));
}

browserSuite("extractable file-manager UI", () => {
  beforeAll(async () => {
    if (!(await Bun.file(join(DIST, "index.html")).exists())) {
      throw new Error("Build the package demo before running browser tests");
    }
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const file = Bun.file(join(DIST, path === "/" ? "index.html" : path.slice(1)));
        return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
      },
    });
  });
  afterEach(() => {
    try {
      activeView?.close();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "WebView closed") {
        throw error;
      }
    }
    activeView = undefined;
  });
  afterAll(() => server?.stop(true));

  for (const layout of ["ledger", "cascade", "outline"]) {
    test(`${layout} moves and renames through the injected host adapter`, async () => {
      const view = await open({ query: `layout=${layout}` });
      await movePilot(view);
      await click(view, `[data-nfm-id="${PILOT_ID}"] input[type=checkbox]`);
      await click(view, "button[data-action=rename]");
      await waitFor(view, "document.querySelector('.nfm-rename-input') !== null");
      await view.type("Renamed pilot");
      await view.press("Enter");
      await waitFor(view, `document.querySelector('.nfm-tbody [data-nfm-id="${PILOT_ID}"] .nfm-name')?.textContent === 'Renamed pilot.mkv'`);
      expect(await view.evaluate<string>(`document.querySelector('.nfm-tbody [data-nfm-id="${PILOT_ID}"] .nfm-name').textContent`)).toBe("Renamed pilot.mkv");
      await saveScreenshot(view, layout);
    });
  }

  test("a collision disables confirmation without removing the source", async () => {
    const view = await open({ query: "folder=hz-s1" });
    await click(view, '[data-nfm-id="hz-s1-e05"] input[type=checkbox]');
    await click(view, "button[data-action=move]");
    await waitFor(view, "document.querySelector('dialog[open] input[type=search]') !== null");
    await view.type("Misc");
    await clickText(view, ".nfm-dest-name > span:first-child", "Misc");
    await waitFor(view, "document.querySelector('.nfm-preview-row[data-issue=collision]') !== null");
    expect(await view.evaluate<boolean>("document.querySelector('[data-testid=move-confirm]').disabled")).toBe(true);
    await view.press("Escape");
    await waitFor(view, "document.querySelector('dialog[open]') === null");
    expect(await view.evaluate<boolean>("document.querySelector('.nfm-tbody [data-nfm-id=hz-s1-e05]') !== null")).toBe(true);
  });

  test("active downloads cannot be moved, renamed or deleted", async () => {
    const view = await open();
    await click(view, '[data-nfm-id="hz-s2-e07"] input[type=checkbox]');
    expect(await view.evaluate<boolean>("['move','rename','delete'].every(action => document.querySelector('button[data-action=' + action + ']').disabled)")).toBe(true);
    expect(await view.evaluate<string>("document.querySelector('.nfm-locknote').textContent")).toContain("Downloading");
  });

  test("move sheets trap focus and restore the initiating control", async () => {
    const view = await open();
    await click(view, `[data-nfm-id="${PILOT_ID}"] input[type=checkbox]`);
    await click(view, "button[data-action=move]");
    await waitFor(view, "document.querySelector('dialog[open]') !== null");
    expect(await view.evaluate<boolean>("document.querySelector('dialog:modal') !== null")).toBe(true);
    await saveScreenshot(view, "modal-focus");
    for (let index = 0; index < 8; index += 1) {
      await view.press("Tab");
      expect(await view.evaluate<boolean>("document.querySelector('dialog[open]').contains(document.activeElement)")).toBe(true);
    }
    await view.press("Escape");
    await waitFor(view, "document.querySelector('dialog[open]') === null");
    expect(await view.evaluate<string>("document.activeElement?.dataset.action ?? ''")).toBe("move");
  });

  test("a narrow mouse viewport selects a folder instead of treating it as a touch tap", async () => {
    const view = await open({ query: "folder=shows", width: 640 });
    await click(view, '.nfm-tbody [data-nfm-id="hoshizora"] .nfm-name');
    expect(await view.evaluate<boolean>("document.querySelector('.nfm-tbody [data-nfm-id=hoshizora][aria-selected=true]') !== null")).toBe(true);
  });

  test("touch taps open folders even on a wide viewport", async () => {
    const view = await open({ query: "folder=shows" });
    await view.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const point = await pointFor(view, '.nfm-tbody [data-nfm-id="hoshizora"] .nfm-name');
    await view.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    await view.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitFor(view, "document.querySelector('.nfm-tbody [data-nfm-id=hz-s1]') !== null");
    expect(await view.evaluate<boolean>("document.querySelector('.nfm-tbody [data-nfm-id=hz-s2]') !== null")).toBe(true);
  });
});
