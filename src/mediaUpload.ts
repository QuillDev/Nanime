import { api, unwrap } from "./api.ts";

export interface MediaUploadProgress {
  readonly fileName: string;
  readonly fileIndex: number;
  readonly fileCount: number;
  readonly uploadedBytes: number;
  readonly totalBytes: number;
}

interface PreparedUpload {
  readonly id: string;
  readonly chunkSize: number;
}

interface ChunkUpload {
  readonly file: File;
  readonly upload: PreparedUpload;
  readonly report: (uploadedBytes: number) => void;
}

interface UploadBatch {
  readonly files: readonly File[];
  readonly folder: string;
  readonly totalBytes: number;
  readonly onProgress: (progress: MediaUploadProgress) => void;
}

async function cancelMediaUpload(id: string): Promise<void> {
  await api.api.media.uploads({ id }).delete();
}

async function uploadChunks(
  context: ChunkUpload,
  offset: number,
): Promise<void> {
  const { file, upload, report } = context;
  if (offset >= file.size) {
    return;
  }
  const end = Math.min(file.size, offset + upload.chunkSize);
  const chunk = new File([file.slice(offset, end)], "chunk", {
    type: "application/octet-stream",
  });
  const uploaded = unwrap(
    await api.api.media.uploads({ id: upload.id }).post({ chunk, offset }),
    "Uploading media",
  );
  report(uploaded.received);
  return uploadChunks(context, uploaded.received);
}

async function transferMediaFile(
  file: File,
  upload: PreparedUpload,
  report: (uploadedBytes: number) => void,
): Promise<void> {
  try {
    await uploadChunks({ file, upload, report }, 0);
    unwrap(
      await api.api.media.uploads({ id: upload.id }).complete.post(),
      "Finishing media upload",
    );
  } catch (error) {
    await cancelMediaUpload(upload.id).catch(() => undefined);
    throw error;
  }
}

async function uploadMediaFile(
  file: File,
  folder: string,
  report: (uploadedBytes: number) => void,
): Promise<void> {
  const upload = unwrap(
    await api.api.media.uploads.post({ fileName: file.name, folder, size: file.size }),
    "Starting media upload",
  );
  return transferMediaFile(file, upload, report);
}

async function uploadFromIndex(
  batch: UploadBatch,
  index: number,
  completedBytes: number,
): Promise<void> {
  const { files, folder, totalBytes, onProgress } = batch;
  const file = files[index];
  if (file === undefined) {
    return;
  }
  await uploadMediaFile(file, folder, (fileBytes) => onProgress({
    fileName: file.name,
    fileIndex: index,
    fileCount: files.length,
    uploadedBytes: completedBytes + fileBytes,
    totalBytes,
  }));
  return uploadFromIndex(batch, index + 1, completedBytes + file.size);
}

export function uploadMediaFiles(
  files: readonly File[],
  folder: string,
  onProgress: (progress: MediaUploadProgress) => void,
): Promise<void> {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  return uploadFromIndex({ files, folder, totalBytes, onProgress }, 0, 0);
}
