import { StrictMode, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { FileManager, type FileManagerLayout } from "../src/index.ts";
import { createMemoryAdapter } from "./adapter.ts";
import { columns, createLockPolicy } from "./fixture.tsx";
import { createDemoStore, INITIAL_LATENCY, type DemoState } from "./store.ts";

type View = FileManagerLayout | "compare";

interface Direction {
  readonly id: FileManagerLayout;
  readonly letter: string;
  readonly name: string;
  readonly note: string;
}

const DIRECTIONS: readonly Direction[] = [
  { id: "ledger", letter: "A", name: "Ledger", note: "Folder tree rail + dense table. Selection swaps the top bar into an action bar." },
  { id: "cascade", letter: "B", name: "Cascade", note: "Parent folders as sibling columns, current folder as the table, floating action dock." },
  { id: "outline", letter: "C", name: "Outline", note: "One expanding tree-table with a persistent inspector holding details and actions." },
];

const params = new URLSearchParams(globalThis.location.search);
const START_FOLDER = params.get("folder") ?? "hz-s2";
const LABELS = { root: "Library", searchPlaceholder: "Search library" };
const OUTLINE_EXPANDED = ["hz-s2"];
const NOTHING_EXPANDED: readonly string[] = [];

const store = createDemoStore(params.get("latency") === "0" ? 0 : INITIAL_LATENCY);
const { subscribe, getState, toggleLatency, toggleFailure, reset } = store;
const adapter = createMemoryAdapter({
  read: () => getState().items,
  write: store.writeItems,
  lockOf: () => createLockPolicy(getState().items),
  latency: () => getState().latency,
  takeFailure: store.takeFailure,
  brokenMove: params.get("broken") === "move",
  log: store.appendLog,
});

// Browser tests read the stored items to assert what a write really changed.
Object.defineProperty(globalThis, "nfmDemo", { configurable: true, value: { snapshot: () => structuredClone(getState().items) } });

function readView(): View {
  const value = params.get("layout");
  return value === "cascade" || value === "outline" || value === "compare" ? value : "ledger";
}

function useView() {
  const [view, setView] = useState<View>(readView);
  const pick = useCallback((next: View) => {
    setView(next);
    const url = new URL(globalThis.location.href);
    url.searchParams.set("layout", next);
    globalThis.history.replaceState(null, "", url);
  }, []);
  return { view, pick };
}

interface ViewButtonProps {
  readonly view: View;
  readonly current: View;
  readonly title?: string;
  readonly label: string;
  readonly onPick: (view: View) => void;
}

function ViewButton({ view, current, title, label, onPick }: ViewButtonProps) {
  const pick = useCallback(() => onPick(view), [onPick, view]);
  return <button type="button" aria-pressed={current === view} onClick={pick} title={title}>{label}</button>;
}

interface PrototypeBarProps {
  readonly state: DemoState;
  readonly view: View;
  readonly selected: number;
  readonly onPick: (view: View) => void;
}

function PrototypeBar({ state, view, selected, onPick }: PrototypeBarProps) {
  return (
    <section className="proto" aria-label="Prototype controls">
      <span className="proto-tag">prototype</span>
      <div className="proto-group" role="toolbar" aria-label="Layout direction">
        {DIRECTIONS.map((direction) => (
          <ViewButton key={direction.id} view={direction.id} current={view} title={direction.note} label={`${direction.letter} ${direction.name}${direction.id === "ledger" ? " ★" : ""}`} onPick={onPick} />
        ))}
        <ViewButton view="compare" current={view} label="compare" onPick={onPick} />
      </div>
      <span className="proto-sep" />
      <button type="button" aria-pressed={state.latency > 0} onClick={toggleLatency}>latency {state.latency > 0 ? "450ms" : "off"}</button>
      <button type="button" aria-pressed={state.failArmed} data-testid="fail-next" onClick={toggleFailure}>{state.failArmed ? "next op will fail" : "fail next op"}</button>
      <button type="button" onClick={reset}>reset data</button>
      <span className="proto-grow" />
      <span className="proto-log" data-testid="selection-echo">onSelectionChange: {selected}</span>
      <span className="proto-log" data-testid="op-log" title={state.log.join("\n")}>{state.log.at(-1) ?? "no writes yet"}</span>
    </section>
  );
}

interface DemoManagerProps {
  readonly state: DemoState;
  readonly layout: FileManagerLayout;
  readonly onSelectionChange: (ids: readonly string[]) => void;
}

function DemoManager({ state, layout, onSelectionChange }: DemoManagerProps) {
  const lockOf = useMemo(() => createLockPolicy(state.items), [state.items]);
  return (
    <FileManager
      items={state.items}
      columns={columns}
      getLock={lockOf}
      layout={layout}
      defaultFolderId={layout === "outline" && !params.has("folder") ? "hoshizora" : START_FOLDER}
      defaultExpandedIds={layout === "outline" ? OUTLINE_EXPANDED : NOTHING_EXPANDED}
      labels={LABELS}
      onOperation={adapter}
      onSelectionChange={onSelectionChange}
    />
  );
}

interface ManagersProps {
  readonly state: DemoState;
  readonly view: View;
  readonly onSelectionChange: (ids: readonly string[]) => void;
}

/** One manager inside a mock host page, or all three layouts side by side. */
function Managers({ state, view, onSelectionChange }: ManagersProps) {
  if (view === "compare") {
    return (
      <main className="compare">
        {DIRECTIONS.map((direction) => (
          <section key={direction.id} className="compare-cell" data-layout={direction.id}>
            <h2><b>{direction.letter}</b> {direction.name}{direction.id === "ledger" && <em>picked</em>}<span>{direction.note}</span></h2>
            <div className="compare-frame"><DemoManager key={`${direction.id}-${state.epoch}`} state={state} layout={direction.id} onSelectionChange={onSelectionChange} /></div>
          </section>
        ))}
      </main>
    );
  }
  return (
    <>
      <header className="host-header">
        <span className="host-logo">nanime</span>
        <nav className="host-tabs" aria-label="Host sections (static)">
          <span>Download</span>
          <span data-active="">Files</span>
          <span>Users</span>
          <span>System</span>
        </nav>
      </header>
      <main className="host-main"><DemoManager key={`single-${state.epoch}`} state={state} layout={view} onSelectionChange={onSelectionChange} /></main>
    </>
  );
}

function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const { view, pick } = useView();
  const [selection, setSelection] = useState<readonly string[]>([]);
  return (
    <div className="demo" data-view={view}>
      <PrototypeBar state={state} view={view} selected={selection.length} onPick={pick} />
      <Managers state={state} view={view} onSelectionChange={setSelection} />
    </div>
  );
}

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(<StrictMode><App /></StrictMode>);
}
