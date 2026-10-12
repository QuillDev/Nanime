import type { FileManagerProps } from "./types.js";
import { useDialogs } from "./useDialogs.js";
import { useListing } from "./useListing.js";
import { useManagerModel, type RootRef } from "./useManagerModel.js";
import { useNavigator } from "./useNavigator.js";
import { useOperationRunner } from "./useOperationRunner.js";
import { useRename } from "./useRename.js";
import { useRowInteractions } from "./useRowInteractions.js";
import { useSelectionState } from "./useSelection.js";
import { useListingOptions } from "./useListingOptions.js";

/** All state and behaviour of one file manager, grouped by concern for the view. */
export function useFileManager<M>(props: FileManagerProps<M>, rootRef: RootRef) {
  const model = useManagerModel(props, rootRef);
  const options = useListingOptions(rootRef);
  const selection = useSelectionState(model.index, props.onSelectionChange);
  const runner = useOperationRunner(props.onOperation);
  const rename = useRename(model, runner);
  const navigator = useNavigator({ props, index: model.index, selection, rename, setQuery: options.setQuery });
  const listing = useListing({ model, options, folderId: navigator.folderId, expanded: navigator.expanded });
  const dialogs = useDialogs({ model, runner, selection, folderId: navigator.folderId, expand: navigator.expand });
  const rows = useRowInteractions({ model, selection, listing, navigator, rename, dialogs, onOpenFile: props.onOpenFile });
  return { model, options, selection, runner, rename, navigator, listing, dialogs, rows };
}

export type Manager<M> = ReturnType<typeof useFileManager<M>>;

export interface ManagerProps<M> {
  readonly manager: Manager<M>;
}
