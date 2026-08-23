import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { uploadSubtitle } from "../subtitleUpload.ts";

interface SubtitleUpload {
  readonly subtitle: File;
  readonly offsetSeconds: number;
}

export function useUploadSubtitle(rel: string): UseMutationResult<void, Error, SubtitleUpload> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subtitle, offsetSeconds }) => uploadSubtitle(rel, subtitle, offsetSeconds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["subtitle-tracks", rel] }),
  });
}
