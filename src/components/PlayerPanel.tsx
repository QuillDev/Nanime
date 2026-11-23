import { ArrowLeft, Check, X } from "lucide-react";
import type { ReactNode } from "react";

interface PlayerPanelProps {
  readonly title: string;
  /** Set inside a submenu: the arrow returns to the panel's first view. */
  readonly onBack?: (() => void) | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const iconButton = "grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Opening a panel moves focus into it, onto what is playing when the panel marks it, so a remote lands inside. */
function focusFirstControl(panel: HTMLElement | null): void {
  (panel?.querySelector<HTMLElement>("[data-player-panel-start]") ?? panel?.querySelector<HTMLElement>("button"))?.focus();
}

/** The frosted panel every player menu opens in, over the right side of the video. */
export function PlayerPanel({ title, onBack, onClose, children }: PlayerPanelProps): React.JSX.Element {
  return (
    <aside ref={focusFirstControl} data-player-panel aria-label={title} className="player-panel absolute inset-y-0 right-0 z-40 flex w-full flex-col bg-black/50 text-sm backdrop-blur-xl sm:w-[20.5rem] lg:w-[25rem]">
      <div className="flex shrink-0 items-center">
        {onBack !== undefined && (
          <button type="button" onClick={onBack} aria-label="Back" className={`${iconButton} -ml-3`}>
            <ArrowLeft className="size-5" />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight lg:text-[22px]">{title}</h2>
        <button type="button" data-player-panel-close onClick={onClose} aria-label="Close" className={`${iconButton} -mr-3`}>
          <X className="size-5" />
        </button>
      </div>
      {children}
    </aside>
  );
}

interface PlayerPanelOptionProps {
  readonly label: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}

/** One choice in a panel list; the current one is ticked. */
export function PlayerPanelOption({ label, active, onSelect }: PlayerPanelOptionProps): React.JSX.Element {
  return (
    <button type="button" aria-pressed={active} onClick={onSelect} className={`flex min-h-11 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[15px] hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "font-semibold text-foreground" : "text-foreground/80"}`}>
      <span className="grid w-5 shrink-0 place-items-center">{active && <Check className="size-4 stroke-[2.5]" aria-hidden="true" />}</span>
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}
