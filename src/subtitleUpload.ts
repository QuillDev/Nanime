import { api, unwrap } from "./api.ts";

export async function uploadSubtitle(
  rel: string,
  subtitle: File,
  offsetSeconds: number,
): Promise<void> {
  unwrap(
    await api.api.subtitles.post({ path: rel, subtitle, offsetSeconds }),
    "Uploading subtitle",
  );
}
