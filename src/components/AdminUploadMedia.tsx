import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { FileUp } from "lucide-react";
import { formatSize } from "../format.ts";
import { useUploadMedia } from "../hooks/useUploadMedia.ts";
import type { MediaUploadProgress } from "../mediaUpload.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { Input } from "./ui/input.tsx";

const VIDEO_ACCEPT = [
  ".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi", ".ts", ".m2ts",
  ".wmv", ".flv", ".mpg", ".mpeg", ".ogv", ".3gp",
].join(",");

function selectedFilesLabel(files: readonly File[]): string {
  if (files.length === 0) {
    return "Choose one or more video files.";
  }
  const bytes = files.reduce((total, file) => total + file.size, 0);
  return `${String(files.length)} ${files.length === 1 ? "file" : "files"} · ${formatSize(bytes)}`;
}

function uploadLabel(files: readonly File[], pending: boolean): string {
  if (pending) {
    return "Uploading…";
  }
  return files.length === 1 ? "Upload file" : `Upload ${String(files.length)} files`;
}

function UploadProgress({ progress }: { readonly progress: MediaUploadProgress }): React.JSX.Element {
  const percent = progress.totalBytes === 0
    ? 0
    : Math.min(100, progress.uploadedBytes / progress.totalBytes * 100);
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {String(progress.fileIndex + 1)} of {String(progress.fileCount)} · {progress.fileName}
        </span>
        <span className="shrink-0">
          {formatSize(progress.uploadedBytes)} / {formatSize(progress.totalBytes)}
        </span>
      </div>
      <progress
        aria-label="File upload progress"
        max={100}
        value={percent}
        className="playback-progress h-2 w-full overflow-hidden rounded-full"
      />
    </div>
  );
}

export function AdminUploadMedia({
  showFolders,
}: {
  readonly showFolders: readonly string[];
}): React.JSX.Element {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [folder, setFolder] = useState("");
  const [progress, setProgress] = useState<MediaUploadProgress | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const upload = useUploadMedia();
  const handleFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFiles(event.target.files === null ? [] : [...event.target.files]);
    setProgress(null);
  }, []);
  const handleFolder = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFolder(event.target.value);
  }, []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (files.length === 0) {
      return;
    }
    setProgress({
      fileName: files[0]?.name ?? "",
      fileIndex: 0,
      fileCount: files.length,
      uploadedBytes: 0,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    });
    upload.mutate({ files, folder: folder.trim(), onProgress: setProgress }, {
      onSuccess: () => {
        setFiles([]);
        setProgress(null);
        setInputKey((current) => current + 1);
      },
    });
  }, [files, folder, upload]);

  return (
    <AdminPanel
      title="Upload files"
      description="Copy video files from this device directly into the library."
      icon={FileUp}
      className="xl:col-span-5"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label htmlFor="admin-media-files" className="block text-sm font-medium">
            Video files
            <input
              key={inputKey}
              id="admin-media-files"
              type="file"
              accept={VIDEO_ACCEPT}
              multiple
              required
              disabled={upload.isPending}
              onChange={handleFiles}
              className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:font-semibold file:text-primary-foreground disabled:opacity-50"
            />
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              {selectedFilesLabel(files)}
            </span>
          </label>
          <label htmlFor="admin-upload-folder" className="block text-sm font-medium">
            Library folder
            <Input
              id="admin-upload-folder"
              value={folder}
              list="admin-upload-folder-options"
              maxLength={1000}
              disabled={upload.isPending}
              placeholder="Show title/Season 1"
              onChange={handleFolder}
              className="mt-2"
            />
            <datalist id="admin-upload-folder-options">
              {showFolders.map((showFolder) => (
                <option key={showFolder} value={`${showFolder}/Season 1`}>
                  {showFolder}/Season 1
                </option>
              ))}
            </datalist>
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              Relative to the media directory. Missing folders are created automatically.
            </span>
          </label>
        </div>
        {progress !== null && <UploadProgress progress={progress} />}
        {upload.error !== null && (
          <p className="text-sm text-destructive">{upload.error.message}</p>
        )}
        {upload.isSuccess && (
          <p className="text-sm text-primary">Upload complete. The files are now in the library.</p>
        )}
        <button
          type="submit"
          disabled={files.length === 0 || upload.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          <FileUp aria-hidden="true" className="size-4" />
          {uploadLabel(files, upload.isPending)}
        </button>
      </form>
    </AdminPanel>
  );
}
