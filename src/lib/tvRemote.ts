/**
 * Android TV support for the web client. The TV app's WebView turns on
 * Chromium's spatial navigation (it does for any device without a touchscreen),
 * so the remote's arrows already move focus between buttons and links. This
 * adds the rest of a TV app: a starting point for focus, focused items kept in
 * the middle of the screen, and the remote's Back button closing whatever is
 * open before it leaves the page.
 */

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

interface NanimeTvBridge {
  /** Called by the app's Back button; true when the page handled it. */
  readonly back: () => boolean;
}

declare global {
  // oxlint-disable-next-line no-var -- a global property needs `var` in a declaration
  var nanimeTv: NanimeTvBridge | undefined;
}

/** The TV app adds `NanimeTV` to the WebView's user agent. */
export function isTvApp(userAgent = navigator.userAgent): boolean {
  return userAgent.includes("NanimeTV/");
}

function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

/** The open layer focus belongs in: a dialog or menu when one is open, else the page. */
function activeLayer(): ParentNode {
  const layers = [...document.querySelectorAll("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='menu'][data-state='open']")];
  return layers.at(-1) ?? document;
}

function startTarget(): HTMLElement | null {
  const layer = activeLayer();
  const scope = layer === document ? document.querySelector("main") : layer;
  const candidates = [
    ...layer.querySelectorAll<HTMLElement>("[data-tv-primary]"),
    ...(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
  ];
  return candidates.find((candidate) => visible(candidate)) ?? null;
}

function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/** An arrow press with nothing focused (first load, or after the focused item went away) lands on the page's main action. */
function handleStartKey(event: KeyboardEvent): void {
  // The player handles its own keys: arrows seek while its controls are hidden.
  if (!ARROW_KEYS.has(event.key) || !focusLost() || document.querySelector("[data-player-controls-visible]") !== null) {
    return;
  }
  const target = startTarget();
  if (target !== null) {
    event.preventDefault();
    event.stopImmediatePropagation();
    target.focus();
  }
}

/** Keeps the focused item away from the screen edges so the next row is always in view. */
function handleFocusIn(event: FocusEvent): void {
  if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) {
    event.target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }
}

function closeDetailsMenu(): boolean {
  const menu = document.activeElement?.closest("details[open]") ?? document.querySelector("details[open]");
  if (menu === null) {
    return false;
  }
  menu.removeAttribute("open");
  menu.querySelector("summary")?.focus();
  return true;
}

function closePopover(): boolean {
  const popover = document.querySelector<HTMLElement>(":popover-open");
  popover?.hidePopover();
  return popover !== null;
}

/** Radix dialogs, menus and selects close on Escape. */
function closeLayer(): boolean {
  if (activeLayer() === document) {
    return false;
  }
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return true;
}

function handleBack(): boolean {
  return closeLayer() || closePopover() || closeDetailsMenu();
}

/** Turns on TV behavior when running inside the Android TV app. */
export function installTvRemote(): void {
  if (!isTvApp()) {
    return;
  }
  document.documentElement.dataset["tv"] = "";
  globalThis.addEventListener("keydown", handleStartKey, { capture: true });
  document.addEventListener("focusin", handleFocusIn);
  globalThis.nanimeTv = { back: handleBack };
}
