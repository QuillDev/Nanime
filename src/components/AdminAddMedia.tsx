import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Search, Upload } from "lucide-react";
import { useAddTorrent } from "../hooks/useAddTorrent.ts";
import { AdminNyaaSearchDialog } from "./AdminNyaaSearch.tsx";
import { AdminPanel } from "./AdminPanel.tsx";
import { Input } from "./ui/input.tsx";
import { SearchableSelect } from "./ui/SearchableSelect.tsx";

type TorrentSource = "file" | "magnet" | "nyaa";

const CATEGORIES = [
  ["1_0", "All anime"],
  ["1_2", "English-translated"],
  ["1_3", "Non-English-translated"],
  ["1_4", "Raw"],
] as const;

function sourceReady(form: {
  readonly source: TorrentSource;
  readonly file: File | null;
  readonly magnet: string;
  readonly nyaaSearch: string;
}): boolean {
  if (form.source === "file") {
    return form.file !== null;
  }
  return form.source === "magnet"
    ? form.magnet.trim() !== ""
    : form.nyaaSearch.trim().length >= 2;
}

function useTorrentSource() {
  const [form, setForm] = useState({
    source: "file" as TorrentSource,
    file: null as File | null,
    magnet: "",
    nyaaSearch: "",
    category: "1_0",
    trusted: false,
  });
  const selectSource = useCallback((source: TorrentSource) => {
    setForm((current) => ({ ...current, source }));
  }, []);
  const handleFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }));
  }, []);
  const handleMagnet = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, magnet: event.target.value }));
  }, []);
  const handleSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, nyaaSearch: event.target.value }));
  }, []);
  const handleCategory = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setForm((current) => ({ ...current, category: event.target.value }));
  }, []);
  const handleTrusted = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, trusted: event.target.checked }));
  }, []);
  return {
    ...form,
    ready: sourceReady(form),
    selectSource,
    handleFile,
    handleMagnet,
    handleSearch,
    handleCategory,
    handleTrusted,
  };
}

type TorrentSourceState = ReturnType<typeof useTorrentSource>;

function SourceFields({ source }: { readonly source: TorrentSourceState }): React.JSX.Element {
  if (source.source === "file") {
    return (
      <label htmlFor="admin-torrent-file" className="block text-sm font-medium">
        Torrent file
        <input
          id="admin-torrent-file"
          type="file"
          accept=".torrent,application/x-bittorrent"
          required
          onChange={source.handleFile}
          className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:font-semibold file:text-primary-foreground"
        />
      </label>
    );
  }
  if (source.source === "magnet") {
    return (
      <label htmlFor="admin-torrent-magnet" className="block text-sm font-medium">
        Magnet link
        <Input
          id="admin-torrent-magnet"
          type="url"
          value={source.magnet}
          required
          autoComplete="off"
          placeholder="magnet:?xt=urn:btih:…"
          onChange={source.handleMagnet}
          className="mt-2"
        />
      </label>
    );
  }
  return (
    <div className="space-y-3">
      <label htmlFor="admin-nyaa-search" className="block text-sm font-medium">
        Search Nyaa
        <Input
          id="admin-nyaa-search"
          type="search"
          value={source.nyaaSearch}
          minLength={2}
          maxLength={200}
          required
          autoComplete="off"
          placeholder="Anime title, release group, resolution…"
          onChange={source.handleSearch}
          className="mt-2"
        />
      </label>
      <label htmlFor="admin-nyaa-category" className="block text-sm font-medium">
        Category
        <select
          id="admin-nyaa-category"
          value={source.category}
          onChange={source.handleCategory}
          className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={source.trusted}
          onChange={source.handleTrusted}
          className="size-4 accent-primary"
        />
        Trusted uploads only
      </label>
    </div>
  );
}

function sourceLabel(source: TorrentSource): string {
  if (source === "file") {
    return "Torrent file";
  }
  return source === "magnet" ? "Magnet link" : "Search Nyaa";
}

function SourceTab({
  source,
  value,
}: {
  readonly source: TorrentSourceState;
  readonly value: TorrentSource;
}): React.JSX.Element {
  const handleClick = useCallback(() => source.selectSource(value), [source, value]);
  return (
    <button
      type="button"
      aria-pressed={source.source === value}
      onClick={handleClick}
      className={source.source === value
        ? "rounded-sm bg-primary px-2 py-2 text-sm font-semibold text-primary-foreground"
        : "rounded-sm bg-background px-2 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"}
    >
      {sourceLabel(value)}
    </button>
  );
}

function SourceTabs({ source }: { readonly source: TorrentSourceState }): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-background p-1">
      {(["file", "magnet", "nyaa"] as const).map((value) => (
        <SourceTab key={value} source={source} value={value} />
      ))}
    </div>
  );
}

function submitLabel(source: TorrentSource, pending: boolean): string {
  if (source === "nyaa") {
    return "Search Nyaa";
  }
  return pending ? "Adding…" : "Add torrent";
}

export function AdminAddMedia({
  showFolders,
}: {
  readonly showFolders: readonly string[];
}): React.JSX.Element {
  const source = useTorrentSource();
  const [showFolder, setShowFolder] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [submittedSearch, setSubmittedSearch] = useState({ query: "", category: "1_0", trusted: false });
  const addTorrent = useAddTorrent();
  const destinationOptions = useMemo(() => [
    { value: "", label: "New show", description: "Library root" },
    ...showFolders.map((folder) => ({
      value: folder,
      label: folder,
      description: "Add as another season",
    })),
  ], [showFolders]);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!source.ready) {
      return;
    }
    if (source.source === "nyaa") {
      setSubmittedSearch({
        query: source.nyaaSearch.trim(),
        category: source.category,
        trusted: source.trusted,
      });
      setResultsOpen(true);
      return;
    }
    addTorrent.mutate({
      file: source.source === "file" ? source.file : null,
      magnet: source.source === "magnet" ? source.magnet.trim() : "",
      showFolder,
    });
  }, [addTorrent, showFolder, source]);

  return (
    <AdminPanel
      title="Add media"
      description="Start a download from a file, magnet link, or Nyaa."
      icon={Upload}
      className="xl:col-span-2"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <SourceTabs source={source} />
        <SourceFields source={source} />
        <div className="space-y-2">
          <p className="text-sm font-medium">Destination</p>
          <SearchableSelect value={showFolder} options={destinationOptions} onValueChange={setShowFolder} placeholder="Choose a destination…" searchPlaceholder="Search library folders…" ariaLabel="Torrent destination" />
        </div>
        {source.source !== "nyaa" && addTorrent.error !== null && (
          <p className="text-sm text-destructive">{addTorrent.error.message}</p>
        )}
        {source.source !== "nyaa" && addTorrent.isSuccess && (
          <p className="text-sm text-primary">Torrent added to qBittorrent.</p>
        )}
        <button
          type="submit"
          disabled={!source.ready || addTorrent.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          {source.source === "nyaa" && <Search aria-hidden="true" className="size-4" />}
          {submitLabel(source.source, addTorrent.isPending)}
        </button>
      </form>
      <AdminNyaaSearchDialog
        open={resultsOpen}
        onOpenChange={setResultsOpen}
        search={submittedSearch.query}
        category={submittedSearch.category}
        trusted={submittedSearch.trusted}
        showFolder={showFolder}
      />
    </AdminPanel>
  );
}
