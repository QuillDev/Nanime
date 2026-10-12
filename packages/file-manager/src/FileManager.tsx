import { useMemo, useRef } from "react";
import { LayoutBody } from "./LayoutBody.js";
import { MobileSelectionBar } from "./MobileSelectionBar.js";
import { Overlays } from "./Overlays.js";
import { StatusBar } from "./StatusBar.js";
import { rootStyle } from "./theme.js";
import { TopBar } from "./TopBar.js";
import type { FileManagerProps } from "./types.js";
import { useFileManager } from "./useFileManager.js";

export function FileManager<M = unknown>(props: FileManagerProps<M>) {
  const { theme, style, className } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const manager = useFileManager(props, rootRef);
  const { model: { layout, compact }, runner: { busy } } = manager;
  const inlineStyle = useMemo(() => rootStyle(theme, style), [theme, style]);
  return (
    <div
      ref={rootRef}
      className={["nfm", `nfm--${layout}`, compact ? "nfm--compact" : "", className ?? ""].filter(Boolean).join(" ")}
      style={inlineStyle}
      data-busy={busy || undefined}
    >
      <TopBar manager={manager} />
      <LayoutBody manager={manager} />
      {layout !== "cascade" || compact ? <StatusBar manager={manager} /> : null}
      <MobileSelectionBar manager={manager} />
      <Overlays manager={manager} />
    </div>
  );
}
