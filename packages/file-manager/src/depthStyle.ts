import { useMemo, type CSSProperties } from "react";

/** Inline custom property that indents tree, outline and destination rows. */
export interface DepthStyle extends CSSProperties {
  readonly "--depth": number;
}

export function useDepthStyle(depth: number): DepthStyle {
  return useMemo(() => ({ "--depth": depth }), [depth]);
}
