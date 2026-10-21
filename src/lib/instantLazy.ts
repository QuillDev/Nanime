import { createElement, lazy, useMemo, type ComponentType, type FunctionComponent } from "react";

export interface InstantLazy<Props extends object> {
  readonly Component: FunctionComponent<Props>;
  readonly load: () => Promise<ComponentType<Props>>;
}

/**
 * A code-split component that renders synchronously once its chunk has loaded.
 * React.lazy suspends on every first render, even for a chunk that's already
 * in memory, and React holds a fresh Suspense fallback for at least 300 ms, so
 * a preloaded page or player still flashed its placeholder. This wrapper picks
 * the loaded component directly when it can and falls back to React.lazy
 * (with its Suspense boundary) only while the chunk is really in flight.
 */
export function instantLazy<Props extends object>(
  importComponent: () => Promise<ComponentType<Props>>,
): InstantLazy<Props> {
  let resolved: ComponentType<Props> | undefined = undefined;
  let pending: Promise<ComponentType<Props>> | undefined = undefined;
  const settle = async (): Promise<ComponentType<Props>> => {
    try {
      resolved = await importComponent();
      return resolved;
    } catch (error: unknown) {
      // Let the next attempt retry a chunk that failed to download.
      pending = undefined;
      throw error;
    }
  };
  const load = (): Promise<ComponentType<Props>> => {
    pending ??= settle();
    return pending;
  };
  const Lazy = lazy(async () => ({ default: await load() }));
  function InstantLazyComponent(props: Props): React.JSX.Element {
    // Chosen once per mount so a chunk finishing mid-life never swaps the
    // element type (which would remount the whole page).
    const loaded = useMemo<ComponentType<Props>>(() => resolved ?? Lazy, []);
    return createElement(loaded, props);
  }
  return { Component: InstantLazyComponent, load };
}
