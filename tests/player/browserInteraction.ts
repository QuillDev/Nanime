import { waitForPlayerState } from "./playerHarness.ts";

export interface ElementTarget {
  readonly ariaLabel?: string;
  readonly index?: number;
  readonly selector: string;
  readonly text?: string;
}

function elementLookup(target: ElementTarget): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const matches = Array.from(document.querySelectorAll(target.selector)).filter((candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const style = getComputedStyle(candidate);
      const bounds = candidate.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" &&
        bounds.width > 0 && bounds.height > 0;
      const labelMatches = target.ariaLabel === undefined ||
        candidate.getAttribute("aria-label") === target.ariaLabel;
      const textMatches = target.text === undefined ||
        candidate.textContent?.replace(/\\s+/gu, " ").trim().includes(target.text) === true;
      return visible && labelMatches && textMatches;
    });
    const element = matches[target.index ?? 0];
    if (!(element instanceof HTMLElement)) return null;
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`;
}

export async function waitForElement(
  view: Bun.WebView,
  target: ElementTarget,
  timeout = 15_000,
): Promise<{ readonly x: number; readonly y: number }> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const bounds = await view.evaluate<{ readonly x: number; readonly y: number } | null>(elementLookup(target));
    if (bounds !== null) {
      return bounds;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for element: ${JSON.stringify(target)}`);
}

export async function clickElement(view: Bun.WebView, target: ElementTarget): Promise<void> {
  const bounds = await waitForElement(view, target);
  await view.click(bounds.x, bounds.y);
}

export async function elementVisible(view: Bun.WebView, target: ElementTarget): Promise<boolean> {
  return await view.evaluate<unknown>(elementLookup(target)) !== null;
}

export async function showPlayerControls(view: Bun.WebView): Promise<void> {
  await view.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 640, y: 360 });
  await waitForPlayerState({
    view,
    predicate: (state) => state.controlsVisible,
    description: "player controls to become visible",
  });
}
