import { api, unwrap } from "./api.ts";

export async function cancelTorrent(hash: string, deleteFiles: boolean): Promise<void> {
  unwrap(
    await api.api.torrents({ hash }).cancel.post({ deleteFiles }),
    "Cancelling torrent",
  );
}
