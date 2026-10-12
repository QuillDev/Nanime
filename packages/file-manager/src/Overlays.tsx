import { DialogHost } from "./DialogHost.js";
import { FilterPopover } from "./FilterPopover.js";
import { ToastRegion } from "./ToastRegion.js";
import type { ManagerProps } from "./useFileManager.js";

/** Layers drawn over the body: the filter popover, the open sheet, and toasts. */
export function Overlays<M>({ manager }: ManagerProps<M>) {
  return (
    <>
      <FilterPopover manager={manager} />
      <DialogHost manager={manager} />
      <ToastRegion manager={manager} />
    </>
  );
}
