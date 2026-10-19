import { formatSize } from "../format.ts";
import type { MediaUploadProgress } from "../mediaUpload.ts";

function UploadProgress({ progress }: { readonly progress: MediaUploadProgress }): React.JSX.Element {
  const percent = progress.totalBytes === 0 ? 0 : Math.min(100, progress.uploadedBytes / progress.totalBytes * 100);
  return (
    <div className="mt-3 max-w-xl" aria-live="polite">
      <p className="flex justify-between gap-3 text-[13px] text-muted-foreground">
        <span className="min-w-0 truncate">Uploading {progress.fileName} ({String(progress.fileIndex + 1)} of {String(progress.fileCount)})</span>
        <span className="shrink-0 tabular-nums">{formatSize(progress.uploadedBytes)} of {formatSize(progress.totalBytes)}</span>
      </p>
      <progress aria-label="File upload progress" max={100} value={percent} className="playback-progress mt-1.5 block h-1 w-full" />
    </div>
  );
}

/** The add bar's single feedback line: upload progress, the latest error, or what just happened. */
export function AddMediaStatus({ addError, added, uploadError, uploaded, progress }: {
  readonly addError: Error | null;
  readonly added: boolean;
  readonly uploadError: Error | null;
  readonly uploaded: boolean;
  readonly progress: MediaUploadProgress | null;
}): React.JSX.Element | null {
  if (progress !== null) {
    return <UploadProgress progress={progress} />;
  }
  const error = addError ?? uploadError;
  if (error !== null) {
    return <p className="mt-2 select-text text-sm text-destructive">{error.message}</p>;
  }
  if (uploaded || added) {
    return <p className="mt-2 text-sm text-muted-foreground">{uploaded ? "Upload complete." : "Sent to qBittorrent."}</p>;
  }
  return null;
}
