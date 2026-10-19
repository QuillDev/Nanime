import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Paperclip, Plus, Search } from "lucide-react";
import { useAddTorrent } from "../hooks/useAddTorrent.ts";
import { useUploadMedia } from "../hooks/useUploadMedia.ts";
import { ADD_MEDIA_ACCEPT, isMagnetLink, sortAddedFiles } from "../lib/addMedia.ts";
import { cn } from "../lib/utils.ts";
import type { MediaUploadProgress } from "../mediaUpload.ts";
import { AdminNyaaSearchDialog } from "./AdminNyaaSearch.tsx";
import { AddMediaStatus } from "./AddMediaStatus.tsx";
import { SearchableSelect } from "./ui/SearchableSelect.tsx";

function useDestination(showFolders: readonly string[]) {
  const [folder, setFolder] = useState("");
  const options = useMemo(() => [
    { value: "", label: "New show", description: "Library root" },
    ...showFolders.map((showFolder) => ({ value: showFolder, label: showFolder, description: "Add as another season" })),
  ], [showFolders]);
  return { folder, setFolder, options };
}

function useFileIntake(folder: string) {
  const addTorrent = useAddTorrent();
  const upload = useUploadMedia();
  const [progress, setProgress] = useState<MediaUploadProgress | null>(null);
  const addFiles = useCallback((files: readonly File[]) => {
    const { torrents, videos } = sortAddedFiles(files);
    for (const file of torrents) {
      addTorrent.mutate({ file, magnet: "", showFolder: folder });
    }
    if (videos.length > 0) {
      upload.mutate({ files: videos, folder, onProgress: setProgress }, { onSettled: () => setProgress(null) });
    }
  }, [addTorrent, folder, upload]);
  return { addTorrent, upload, progress, addFiles };
}

function useDropZone(onFiles: (files: readonly File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);
  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    onFiles([...event.dataTransfer.files]);
  }, [onFiles]);
  return { dragging, handleDragOver, handleDragLeave, handleDrop };
}

function useAddBar(showFolders: readonly string[]) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const destination = useDestination(showFolders);
  const intake = useFileIntake(destination.folder);
  const magnet = isMagnetLink(text);
  const handleText = useCallback((event: ChangeEvent<HTMLInputElement>) => setText(event.target.value), []);
  const handleSearchOpen = useCallback((open: boolean) => setSearch(open ? search : null), [search]);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (magnet) {
      intake.addTorrent.mutate({ file: null, magnet: text.trim(), showFolder: destination.folder }, { onSuccess: () => setText("") });
      return;
    }
    setSearch(text.trim());
  }, [destination.folder, intake.addTorrent, magnet, text]);
  return { text, search, destination, intake, magnet, handleText, handleSearchOpen, handleSubmit };
}

function useFilePicker(onFiles: (files: readonly File[]) => void) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const handleBrowse = useCallback(() => fileInput.current?.click(), []);
  const handleFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    onFiles(event.target.files === null ? [] : [...event.target.files]);
    event.target.value = "";
  }, [onFiles]);
  return { fileInput, handleBrowse, handleFiles };
}

/** One bar for every way media arrives: magnet links, Nyaa searches, .torrent files and video uploads. */
export function AdminAddMedia({ showFolders }: { readonly showFolders: readonly string[] }): React.JSX.Element {
  const { text, search, destination, intake, magnet, handleText, handleSearchOpen, handleSubmit } = useAddBar(showFolders);
  const { fileInput, handleBrowse, handleFiles } = useFilePicker(intake.addFiles);
  const drop = useDropZone(intake.addFiles);
  const handleFolder = destination.setFolder;
  return (
    <div onDragOver={drop.handleDragOver} onDragLeave={drop.handleDragLeave} onDrop={drop.handleDrop}>
      <form onSubmit={handleSubmit} className={cn("flex flex-wrap items-center gap-2 rounded-xl transition-shadow", drop.dragging && "ring-2 ring-primary ring-offset-4 ring-offset-background")}>
        <label htmlFor="admin-add-media" className="sr-only">Magnet link or Nyaa search</label>
        <div className="flex min-w-60 flex-1 items-center rounded-lg border border-input bg-secondary focus-within:ring-2 focus-within:ring-ring">
          <input
            id="admin-add-media"
            value={text}
            onChange={handleText}
            autoComplete="off"
            placeholder="Paste a magnet link, search Nyaa, or drop files"
            className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={handleBrowse} aria-label="Choose .torrent or video files" title="Choose .torrent or video files" className="mr-1 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Paperclip className="size-4" />
          </button>
          <input ref={fileInput} type="file" multiple accept={ADD_MEDIA_ACCEPT} onChange={handleFiles} className="hidden" />
        </div>
        <div className="w-48">
          <SearchableSelect value={destination.folder} options={destination.options} onValueChange={handleFolder} placeholder="Destination" searchPlaceholder="Search library folders…" ariaLabel="Destination" />
        </div>
        <button type="submit" disabled={text.trim().length < 2 || intake.addTorrent.isPending} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-semibold text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground">
          {magnet ? <Plus className="size-4" /> : <Search className="size-4" />}
          {magnet ? "Add" : "Search"}
        </button>
      </form>
      <AddMediaStatus addError={intake.addTorrent.error} added={intake.addTorrent.isSuccess} uploadError={intake.upload.error} uploaded={intake.upload.isSuccess} progress={intake.progress} />
      <AdminNyaaSearchDialog open={search !== null} onOpenChange={handleSearchOpen} search={search ?? ""} showFolder={destination.folder} />
    </div>
  );
}
