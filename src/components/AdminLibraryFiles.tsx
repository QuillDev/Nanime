import "@nanime/file-manager/styles.css";
import { useCallback, useMemo } from "react";
import { FileManager, modifiedColumn, sizeColumn, type FileOperation, type OperationResult } from "@nanime/file-manager";
import { TriangleAlert } from "lucide-react";
import { SectionHelp } from "./SectionHelp.tsx";
import type { LibraryFileItem } from "../../shared/libraryFiles.ts";
import { useLibraryFileOperation, useLibraryFiles } from "../hooks/useLibraryFiles.ts";
import {
  LIBRARY_FILE_COLUMNS, libraryFileItems, libraryFileLock, libraryFileRequest, operationMessage, type LibraryFile,
} from "../lib/libraryFileManager.ts";

const COLUMNS = [...LIBRARY_FILE_COLUMNS, sizeColumn<LibraryFileItem>(), modifiedColumn<LibraryFileItem>()];
const LABELS = {
  root: "Library",
  searchPlaceholder: "Search the library",
  empty: "This folder is empty",
  noResults: "Nothing matches",
} as const;
const NO_FILES: readonly LibraryFile[] = [];

function useOperationHandler(items: readonly LibraryFile[]): (operation: FileOperation) => Promise<OperationResult> {
  const { mutateAsync } = useLibraryFileOperation();
  const byId = useMemo(() => new Map(items.flatMap((item) => (item.metadata === undefined ? [] : [[item.id, item.metadata] as const]))), [items]);
  return useCallback(async (operation: FileOperation): Promise<OperationResult> => {
    const result = await mutateAsync(libraryFileRequest(operation, byId));
    const message = operationMessage(result);
    if (!result.revertible) {
      return message === undefined ? {} : { message };
    }
    // Undo is the server's verified inverse of this exact operation.
    const undo = async (): Promise<void> => {
      await mutateAsync({ type: "revert", operationId: result.operationId });
    };
    return message === undefined ? { undo } : { undo, message };
  }, [byId, mutateAsync]);
}

function OwnershipNotice(): React.JSX.Element {
  return (
    <output className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      qBittorrent can’t be reached, so torrent-owned files can’t be identified. Renaming, moving, and deleting are paused; you can still browse and create folders.
    </output>
  );
}

export function AdminLibraryFiles(): React.JSX.Element {
  const files = useLibraryFiles();
  const items = useMemo(() => (files.data === undefined ? NO_FILES : libraryFileItems(files.data.items)), [files.data]);
  const handleOperation = useOperationHandler(items);
  return (
    <section aria-labelledby="library-files-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="library-files-title" className="text-sm font-semibold">Library files</h2>
        <SectionHelp label="About library files">
          Organize folders and files under the library root. Watch progress, history, and mappings follow moved media; deleted items go to Nanime’s trash and can be undone.
        </SectionHelp>
      </div>
      {files.data?.torrentOwnership === "unavailable" && <OwnershipNotice />}
      {files.error !== null && <p className="select-text text-sm text-destructive">{files.error.message}</p>}
      {files.isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading library files…</p>
      ) : (
        <div className="h-[min(78dvh,52rem)] min-h-[28rem]">
          <FileManager items={items} columns={COLUMNS} getLock={libraryFileLock} labels={LABELS} onOperation={handleOperation} />
        </div>
      )}
    </section>
  );
}
