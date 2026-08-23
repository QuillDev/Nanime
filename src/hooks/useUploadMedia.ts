import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { uploadMediaFiles, type MediaUploadProgress } from "../mediaUpload.ts";
import { storageStatusKey } from "./useStorageStatus.ts";
import { refreshLibraryCache } from "./refreshLibraryCache.ts";

interface UploadMediaVariables {
  readonly files: readonly File[];
  readonly folder: string;
  readonly onProgress: (progress: MediaUploadProgress) => void;
}

export function useUploadMedia(): UseMutationResult<void, Error, UploadMediaVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, folder, onProgress }) => uploadMediaFiles(files, folder, onProgress),
    onSuccess: () => Promise.all([
      refreshLibraryCache(queryClient),
      queryClient.invalidateQueries({ queryKey: storageStatusKey }),
    ]),
  });
}
