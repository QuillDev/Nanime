import { createContext, useContext, useId, useLayoutEffect, useMemo, type ReactNode, type RefObject } from "react";
import { CloseIcon, WarnIcon } from "./icons.js";
import { useModal } from "./modal.js";

interface SheetFrame {
  readonly titleId: string;
  readonly busy: boolean;
  readonly onClose: () => void;
}

const SheetContext = createContext<SheetFrame>({ titleId: "", busy: false, onClose: () => undefined });

export interface SheetProps {
  readonly className?: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  /** A `SheetHeader`, the body, and a `SheetFooter`, in that order. */
  readonly children: ReactNode;
}

/** Focuses the preferred control after native modality is established. */
function useInitialFocus(panel: RefObject<HTMLDialogElement | null>): void {
  useLayoutEffect(() => {
    const dialog = panel.current;
    const control = dialog?.querySelector<HTMLElement>("[data-autofocus]")
      ?? dialog?.querySelector<HTMLElement>("input")
      ?? dialog?.querySelector<HTMLElement>("button:not([disabled])");
    control?.focus();
  }, [panel]);
}

/** Native modal sheet over a dimmed backdrop. Busy sheets can't be dismissed. */
export function Sheet({ className, busy, onClose, children }: SheetProps) {
  const titleId = useId();
  const { panel, onCancel } = useModal(busy ? null : onClose);
  useInitialFocus(panel);
  const frame = useMemo(() => ({ titleId, busy, onClose }), [titleId, busy, onClose]);
  return (
    <div className="nfm-overlay">
      <dialog
        ref={panel}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        className={`nfm-sheet ${className ?? ""}`}
        onCancel={onCancel}
      >
        <SheetContext.Provider value={frame}>{children}</SheetContext.Provider>
      </dialog>
    </div>
  );
}

export interface SheetHeaderProps {
  readonly title: string;
  /** Optional subtitle line under the title. */
  readonly children?: ReactNode;
}

export function SheetHeader({ title, children }: SheetHeaderProps) {
  const { titleId, busy, onClose } = useContext(SheetContext);
  return (
    <header className="nfm-sheet-head">
      <div>
        <h2 id={titleId}>{title}</h2>
        {children !== undefined && <p>{children}</p>}
      </div>
      <button type="button" className="nfm-iconbtn" aria-label="Close" disabled={busy} onClick={onClose}><CloseIcon /></button>
    </header>
  );
}

export interface SheetFooterProps {
  readonly children: ReactNode;
}

export function SheetFooter({ children }: SheetFooterProps) {
  return <footer className="nfm-sheet-foot">{children}</footer>;
}

export interface ErrorLineProps {
  readonly error: string | null;
}

export function ErrorLine({ error }: ErrorLineProps) {
  return error === null ? null : <p className="nfm-error" role="alert"><WarnIcon /> <span>{error}</span></p>;
}
