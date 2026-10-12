import { useCallback, useId } from "react";
import { WidgetRole } from "./aria.js";
import type { FilterMode, ValueRow } from "./filterValues.js";
import { SearchIcon } from "./icons.js";
import { useFilterPanel, type FilterPanelInput } from "./useFilterPanel.js";

interface ModeOption {
  readonly mode: FilterMode;
  readonly label: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { mode: "all", label: "Any" },
  { mode: "nonblank", label: "Not blank" },
  { mode: "blank", label: "Blank" },
];

interface ModeButtonProps {
  readonly option: ModeOption;
  readonly current: FilterMode;
  readonly onSelect: (mode: FilterMode) => void;
}

function ModeButton({ option, current, onSelect }: ModeButtonProps) {
  const select = useCallback(() => onSelect(option.mode), [onSelect, option.mode]);
  return <button type="button" role={WidgetRole.radio} aria-checked={current === option.mode} onClick={select}>{option.label}</button>;
}

interface ValueOptionProps {
  readonly row: ValueRow;
  readonly checked: boolean;
  readonly onToggle: (key: string) => void;
}

function ValueOption({ row, checked, onToggle }: ValueOptionProps) {
  const toggle = useCallback(() => onToggle(row.key), [onToggle, row.key]);
  return (
    <label className="nfm-filter-option" data-blank={row.blank || undefined}>
      <input type="checkbox" className="nfm-check" checked={checked} onChange={toggle} />
      <span className="nfm-filter-label">{row.label}</span>
      <span className="nfm-num">{row.count}</span>
    </label>
  );
}

export function FilterPanel<M>(props: FilterPanelInput<M>) {
  const { column } = props;
  const panel = useFilterPanel(props);
  const searchId = useId();
  return (
    <div className="nfm-filter" role={WidgetRole.group} aria-label={`Filter ${column.header}`}>
      <div className="nfm-seg" role="radiogroup" aria-label="Filter mode">
        {MODE_OPTIONS.map((option) => <ModeButton key={option.mode} option={option} current={panel.mode} onSelect={panel.handleSelectMode} />)}
      </div>
      <label className="nfm-field nfm-field--sm" htmlFor={searchId}>
        <SearchIcon />
        <input id={searchId} type="search" value={panel.query} placeholder={`Search ${column.header.toLocaleLowerCase()}`} onChange={panel.handleQuery} autoComplete="off" />
      </label>
      <div className="nfm-filter-bulk">
        <span>{panel.shown.length} {panel.shown.length === 1 ? "value" : "values"}</span>
        <button type="button" onClick={panel.handleSelectShown}>Select all</button>
        <button type="button" onClick={panel.handleClearShown}>Clear</button>
      </div>
      <ul className="nfm-filter-list">
        {panel.shown.map((row) => (
          <li key={row.key}>
            <ValueOption row={row} checked={panel.checked.has(row.key)} onToggle={panel.handleToggle} />
          </li>
        ))}
        {panel.shown.length === 0 && <li className="nfm-filter-none">No matching values</li>}
      </ul>
    </div>
  );
}
