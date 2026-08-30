import { waitForPlayerState } from "./playerHarness.ts";

export interface ElementTarget {
  readonly ancestorText?: string;
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
      const ancestorMatches = target.ancestorText === undefined ||
        candidate.closest("li")?.textContent?.includes(target.ancestorText) === true;
      const textMatches = target.text === undefined ||
        candidate.textContent?.replace(/\\s+/gu, " ").trim().includes(target.text) === true;
      return visible && labelMatches && ancestorMatches && textMatches;
    });
    const element = matches[target.index ?? 0];
    if (!(element instanceof HTMLElement)) return null;
    const bounds = element.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > innerHeight || bounds.left < 0 || bounds.right > innerWidth) {
      element.scrollIntoView({ block: "center", inline: "center" });
      return null;
    }
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

export async function clickStableElement(view: Bun.WebView, target: ElementTarget): Promise<void> {
  const deadline = Date.now() + 15_000;
  let previous: { readonly x: number; readonly y: number } | null = null;
  while (Date.now() < deadline) {
    const current = await waitForElement(view, target, Math.max(100, deadline - Date.now()));
    if (previous !== null && Math.abs(current.x - previous.x) < 1 && Math.abs(current.y - previous.y) < 1) {
      await view.click(current.x, current.y);
      return;
    }
    previous = current;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for stable element: ${JSON.stringify(target)}`);
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
