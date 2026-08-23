import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SearchableSelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: string;
}

interface SearchableSelectProps {
  readonly value: string;
  readonly options: readonly SearchableSelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly placeholder: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
}

interface PopupDismissOptions {
  readonly open: boolean;
  readonly triggerRef: React.RefObject<HTMLButtonElement | null>;
  readonly menuRef: React.RefObject<HTMLDivElement | null>;
  readonly close: () => void;
}

function usePopupDismiss({ open, triggerRef, menuRef, close }: PopupDismissOptions): void {
  const handleOutside = useEffectEvent((event: globalThis.PointerEvent): void => {
    const { target } = event;
    if (
      target instanceof Node &&
      !triggerRef.current?.contains(target) &&
      !menuRef.current?.contains(target)
    ) {
      close();
    }
  });
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [open]);
}

function usePopup(disabled: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const close = useCallback(() => setOpen(false), []);
  const handleToggle = useCallback(() => {
    if (disabled) {
      return;
    }
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!open && bounds !== undefined) {
      setPosition({ left: bounds.left, top: bounds.bottom + 8, width: bounds.width });
    }
    setOpen((current) => !current);
  }, [disabled, open]);
  const style = useMemo<CSSProperties>(() => {
    const { left, top, width } = position;
    return { left, top, width };
  }, [position]);
  usePopupDismiss({ open, triggerRef, menuRef, close });
  return { triggerRef, menuRef, menuId, open, close, handleToggle, style };
}

export function SearchableSelect({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No matches found.",
  disabled = false,
  ariaLabel,
}: SearchableSelectProps): React.JSX.Element {
  const { triggerRef, menuRef, menuId, open, close, handleToggle, style } = usePopup(disabled);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle === "" ? options : options.filter((option) => (
      `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`
        .toLocaleLowerCase()
        .includes(needle)
    ));
  }, [options, query]);
  const handleQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);
  const handleSelect = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    onValueChange(event.currentTarget.dataset["value"] ?? "");
    setQuery("");
    close();
  }, [close, onValueChange]);

  const results = (
    <div ref={menuRef} id={menuId} style={style} className="fixed z-[1000] rounded-md border border-border bg-card p-2 shadow-xl">
      <div className="relative mb-2">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={handleQuery}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="searchable-select-results max-h-72 overflow-y-auto">
        {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>}
        {filtered.map((option) => (
          <button
            key={option.value}
            type="button"
            data-value={option.value}
            onClick={handleSelect}
            className="flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <Check aria-hidden="true" className={option.value === value ? "mt-0.5 size-4 shrink-0 text-primary" : "mt-0.5 size-4 shrink-0 text-card"} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{option.label}</span>
              {option.description !== undefined && <span className="block truncate text-xs text-muted-foreground">{option.description}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={handleToggle}
        className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selected === undefined ? "truncate text-muted-foreground" : "truncate"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown aria-hidden="true" className={open ? "size-4 shrink-0 rotate-180 text-muted-foreground" : "size-4 shrink-0 text-muted-foreground"} />
      </button>
      {open && createPortal(results, document.body)}
    </div>
  );
}
