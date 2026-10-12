// Demo-only state that lives outside React: the fictitious library plus the
// prototype switches. The adapter reads it at call time; the page subscribes.
import { createFixture, type Item } from "./fixture.tsx";

export interface DemoState {
  readonly items: readonly Item[];
  /** Simulated host latency in milliseconds. */
  readonly latency: number;
  /** The next operation will be refused. */
  readonly failArmed: boolean;
  /** Last 20 adapter writes, oldest first. */
  readonly log: readonly string[];
  /** Bumped by reset so the managers remount with fresh state. */
  readonly epoch: number;
}

const LATENCY_MS = 450;
const LOG_LENGTH = 20;

export function createDemoStore(latency: number) {
  let state: DemoState = { items: createFixture(), latency, failArmed: false, log: [], epoch: 0 };
  const listeners = new Set<() => void>();
  const update = (next: DemoState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    getState: (): DemoState => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    writeItems: (items: readonly Item[]) => update({ ...state, items }),
    appendLog: (line: string) => update({ ...state, log: [...state.log.slice(1 - LOG_LENGTH), line] }),
    toggleLatency: () => update({ ...state, latency: state.latency > 0 ? 0 : LATENCY_MS }),
    toggleFailure: () => update({ ...state, failArmed: !state.failArmed }),
    /** Reports (and disarms) a pending simulated failure. */
    takeFailure: (): boolean => {
      const armed = state.failArmed;
      update({ ...state, failArmed: false });
      return armed;
    },
    reset: () => update({ ...state, items: createFixture(), log: [], epoch: state.epoch + 1 }),
  };
}

export type DemoStore = ReturnType<typeof createDemoStore>;

export const INITIAL_LATENCY = LATENCY_MS;
