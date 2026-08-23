import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { useAddTorrent } from "../hooks/useAddTorrent.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { Input } from "./ui/input.tsx";

type TorrentSource = "file" | "magnet";

function useTorrentSource(): {
  readonly source: TorrentSource;
  readonly file: File | null;
  readonly magnet: string;
  readonly ready: boolean;
  readonly handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleMagnetChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleFileSource: () => void;
  readonly handleMagnetSource: () => void;
} {
  const [source, setSource] = useState<TorrentSource>("file");
  const [file, setFile] = useState<File | null>(null);
  const [magnet, setMagnet] = useState<string>("");
  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  }, []);
  const handleMagnetChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setMagnet(event.target.value);
  }, []);
  const handleFileSource = useCallback(() => setSource("file"), []);
  const handleMagnetSource = useCallback(() => setSource("magnet"), []);
  const ready = source === "file" ? file !== null : magnet.trim() !== "";
  return {
    source,
    file,
    magnet,
    ready,
    handleFileChange,
    handleMagnetChange,
    handleFileSource,
    handleMagnetSource,
  };
}

export function AdminAddMedia({
  showFolders,
}: {
  readonly showFolders: readonly string[];
}): React.JSX.Element {
  const torrentSource = useTorrentSource();
  const [showFolder, setShowFolder] = useState<string>("");
  const addTorrent = useAddTorrent();
  const handleFolderChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setShowFolder(event.target.value);
  }, []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (torrentSource.ready) {
      addTorrent.mutate({
        file: torrentSource.source === "file" ? torrentSource.file : null,
        magnet: torrentSource.source === "magnet" ? torrentSource.magnet.trim() : "",
        showFolder,
      });
    }
  }, [addTorrent, showFolder, torrentSource]);

  return (
    <AdminPanel
      title="Add media"
      description="Send a torrent or magnet link to qBittorrent."
      icon={Upload}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background p-1">
          <button
            type="button"
            aria-pressed={torrentSource.source === "file"}
            onClick={torrentSource.handleFileSource}
            className={torrentSource.source === "file"
              ? "rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              : "rounded-sm bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"}
          >
            Torrent file
          </button>
          <button
            type="button"
            aria-pressed={torrentSource.source === "magnet"}
            onClick={torrentSource.handleMagnetSource}
            className={torrentSource.source === "magnet"
              ? "rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              : "rounded-sm bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"}
          >
            Magnet link
          </button>
        </div>
        {torrentSource.source === "file" ? (
          <label htmlFor="admin-torrent-file" className="block text-sm font-medium">
            Torrent file
            <input
              id="admin-torrent-file"
              type="file"
              accept=".torrent,application/x-bittorrent"
              required
              onChange={torrentSource.handleFileChange}
              className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:font-semibold file:text-primary-foreground"
            />
          </label>
        ) : (
          <label htmlFor="admin-torrent-magnet" className="block text-sm font-medium">
            Magnet link
            <Input
              id="admin-torrent-magnet"
              type="url"
              value={torrentSource.magnet}
              required
              autoComplete="off"
              placeholder="magnet:?xt=urn:btih:…"
              onChange={torrentSource.handleMagnetChange}
              className="mt-2"
            />
          </label>
        )}
        <label htmlFor="admin-torrent-destination" className="block text-sm font-medium">
          Destination
          <select
            id="admin-torrent-destination"
            value={showFolder}
            onChange={handleFolderChange}
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">New show (library root)</option>
            {showFolders.map((folder) => (
              <option key={folder} value={folder}>Season of {folder}</option>
            ))}
          </select>
        </label>
        {addTorrent.error !== null && (
          <p className="text-sm text-destructive">{addTorrent.error.message}</p>
        )}
        {addTorrent.isSuccess && (
          <p className="text-sm text-primary">Torrent added to qBittorrent.</p>
        )}
        <button
          type="submit"
          disabled={!torrentSource.ready || addTorrent.isPending}
          className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          {addTorrent.isPending ? "Adding…" : "Add torrent"}
        </button>
      </form>
    </AdminPanel>
  );
}
