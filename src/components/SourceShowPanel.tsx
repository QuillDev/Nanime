import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { ArrowLeft, Download, Film } from "lucide-react";
import { adminTabHref } from "../hooks/useMediaRoute.ts";
import { useEpisodeDownload, useSourceShow } from "../hooks/useSources.ts";
import type { SourceEpisode, SourceResult, SourceShow } from "../sourcesApi.ts";
import { ListSkeleton } from "./Skeleton.tsx";
import { SearchableSelect } from "./ui/SearchableSelect.tsx";

interface PanelProps {
  readonly sourceId: string;
  readonly result: SourceResult;
  readonly showFolders: readonly string[];
  readonly onBack: () => void;
}

/** An existing show folder with the same name, else a new folder named after the show. */
function defaultFolder(name: string, showFolders: readonly string[]): string {
  const lower = name.trim().toLowerCase();
  return showFolders.find((folder) => folder.toLowerCase() === lower) ?? name.trim();
}

function useFolder(show: SourceShow, showFolders: readonly string[]) {
  const name = show.name.trim() === "" ? "New show" : show.name.trim();
  const [folder, setFolder] = useState(() => defaultFolder(name, showFolders));
  const options = useMemo(() => [
    ...showFolders.includes(name) ? [] : [{ value: name, label: name, description: "New show" }],
    ...showFolders.map((showFolder) => ({ value: showFolder, label: showFolder, description: "Existing show" })),
  ], [name, showFolders]);
  return { folder, handleFolder: setFolder, options };
}

function EpisodeRow({ episode, checked, onToggle }: {
  readonly episode: SourceEpisode;
  readonly checked: boolean;
  readonly onToggle: (url: string) => void;
}): React.JSX.Element {
  const handleChange = useCallback(() => onToggle(episode.url), [onToggle, episode.url]);
  return (
    <li className="border-b border-border last:border-b-0">
      <label className="flex cursor-pointer items-center gap-3 py-2.5 text-sm">
        <input type="checkbox" checked={checked} onChange={handleChange} className="size-4 accent-primary" />
        <span className="w-10 shrink-0 font-semibold tabular-nums text-muted-foreground">E{episode.number}</span>
        <span className="min-w-0 truncate">{episode.name}</span>
      </label>
    </li>
  );
}

function useEpisodePicks(episodes: readonly SourceEpisode[]) {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const handleToggle = useCallback((url: string) => setSkipped((current) => {
    const next = new Set(current);
    if (!next.delete(url)) {
      next.add(url);
    }
    return next;
  }), []);
  const allPicked = skipped.size === 0;
  const handleAll = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSkipped(event.target.checked ? new Set() : new Set(episodes.map((episode) => episode.url)));
  }, [episodes]);
  const picked = useMemo(() => episodes.filter((episode) => !skipped.has(episode.url)), [episodes, skipped]);
  return { skipped, picked, allPicked, handleToggle, handleAll };
}

function ShowEpisodes({ sourceId, show, showFolders }: { readonly sourceId: string; readonly show: SourceShow; readonly showFolders: readonly string[] }): React.JSX.Element {
  const destination = useFolder(show, showFolders);
  const picks = useEpisodePicks(show.episodes);
  const download = useEpisodeDownload();
  const handleDownload = useCallback(() => {
    download.mutate({ id: sourceId, showFolder: destination.folder, episodes: picks.picked });
  }, [destination.folder, download, picks.picked, sourceId]);
  if (show.episodes.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">This source lists no episodes for the show.</p>;
  }
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 sm:w-80">
          <SearchableSelect value={destination.folder} options={destination.options} onValueChange={destination.handleFolder} placeholder="Show folder" ariaLabel="Show folder" />
        </div>
        <button type="button" onClick={handleDownload} disabled={picks.picked.length === 0 || download.isPending} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Download aria-hidden="true" className="size-4" />
          Download {picks.picked.length === show.episodes.length ? "all" : picks.picked.length}
        </button>
      </div>
      {download.error !== null && <p className="select-text pt-2 text-sm text-destructive">{download.error.message}</p>}
      {download.isSuccess && (
        <p className="pt-2 text-sm text-primary">Queued. <a href={adminTabHref("downloads")} className="underline underline-offset-2">See downloads</a></p>
      )}
      <label className="mt-4 flex items-center gap-3 border-b border-border py-2.5 text-sm font-semibold">
        <input type="checkbox" checked={picks.allPicked} onChange={picks.handleAll} className="size-4 accent-primary" />
        Episodes
      </label>
      <ul>
        {show.episodes.map((episode) => <EpisodeRow key={episode.url} episode={episode} checked={!picks.skipped.has(episode.url)} onToggle={picks.handleToggle} />)}
      </ul>
    </div>
  );
}

function ShowHeader({ show, fallbackImage }: { readonly show: SourceShow; readonly fallbackImage: string | null }): React.JSX.Element {
  const image = show.imageUrl ?? fallbackImage;
  return (
    <div className="flex gap-4">
      <span className="relative flex aspect-[2/3] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary sm:w-28">
        {image === null ? <Film aria-hidden="true" className="size-6 text-muted-foreground" /> : <img src={image} alt="" className="absolute inset-0 size-full object-cover" />}
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-bold tracking-tight">{show.name}</h2>
        {show.genres.length > 0 && <p className="mt-1 text-sm text-muted-foreground">{show.genres.join(", ")}</p>}
        {show.description !== null && <p className="mt-2 line-clamp-4 select-text text-sm text-muted-foreground">{show.description}</p>}
      </div>
    </div>
  );
}

/** The show as listed, named after the search result when the source gives no name. */
function named(show: SourceShow | undefined, name: string): SourceShow | undefined {
  return show === undefined || show.name !== "" ? show : { ...show, name };
}

export function SourceShowPanel({ sourceId, result, showFolders, onBack }: PanelProps): React.JSX.Element {
  const listed = useSourceShow(sourceId, result.link);
  const show = useMemo(() => named(listed.data, result.name), [listed.data, result.name]);
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Results
      </button>
      {listed.status === "pending" && <ListSkeleton rows={4} />}
      {listed.status === "error" && <p className="select-text py-4 text-sm text-destructive">{listed.error.message}</p>}
      {show !== undefined && (
        <>
          <ShowHeader show={show} fallbackImage={result.imageUrl} />
          <ShowEpisodes key={result.link} sourceId={sourceId} show={show} showFolders={showFolders} />
        </>
      )}
    </div>
  );
}
