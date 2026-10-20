import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Film, Search } from "lucide-react";
import { useSourceSearch, useSources } from "../hooks/useSources.ts";
import type { InstalledSourceView, SourceResult } from "../sourcesApi.ts";
import { AdminPage } from "./AdminPage.tsx";
import { SourceManager } from "./SourceManager.tsx";
import { SourceShowPanel } from "./SourceShowPanel.tsx";
import { ListSkeleton } from "./Skeleton.tsx";
import { SearchableSelect } from "./ui/SearchableSelect.tsx";

const EMPTY_SOURCES: readonly InstalledSourceView[] = [];

function ResultTile({ result, onPick }: { readonly result: SourceResult; readonly onPick: (result: SourceResult) => void }): React.JSX.Element {
  const handleClick = useCallback(() => onPick(result), [onPick, result]);
  return (
    <li>
      <button type="button" onClick={handleClick} className="group w-full text-left focus-visible:outline-none">
        <span className="relative flex aspect-[2/3] items-center justify-center overflow-hidden rounded-md bg-secondary group-focus-visible:ring-2 group-focus-visible:ring-ring">
          {result.imageUrl === null
            ? <Film aria-hidden="true" className="size-6 text-muted-foreground" />
            : <img src={result.imageUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-[1.03]" />}
        </span>
        <span className="mt-2 line-clamp-2 text-sm font-medium group-hover:text-primary">{result.name}</span>
      </button>
    </li>
  );
}

/** A result without cover art (a torrent, say) as one row: its name and the source's summary. */
function ResultRow({ result, onPick }: { readonly result: SourceResult; readonly onPick: (result: SourceResult) => void }): React.JSX.Element {
  const handleClick = useCallback(() => onPick(result), [onPick, result]);
  return (
    <li>
      <button type="button" onClick={handleClick} className="group w-full py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block break-words text-sm font-medium group-hover:text-primary">{result.name}</span>
        {result.description !== null && <span className="mt-0.5 block text-xs text-muted-foreground">{result.description}</span>}
      </button>
    </li>
  );
}

function ResultList({ results, onPick }: { readonly results: readonly SourceResult[]; readonly onPick: (result: SourceResult) => void }): React.JSX.Element {
  if (results.every((result) => result.imageUrl === null)) {
    return <ul className="divide-y divide-border">{results.map((result) => <ResultRow key={result.link} result={result} onPick={onPick} />)}</ul>;
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-5">
      {results.map((result) => <ResultTile key={result.link} result={result} onPick={onPick} />)}
    </ul>
  );
}

function Results({ sourceId, query, onPick }: {
  readonly sourceId: string;
  readonly query: string;
  readonly onPick: (result: SourceResult) => void;
}): React.JSX.Element | null {
  const results = useSourceSearch(sourceId, query);
  if (query === "") {
    return null;
  }
  if (results.status === "pending") {
    return <ListSkeleton rows={3} />;
  }
  if (results.status === "error") {
    return <p className="select-text py-4 text-sm text-destructive">{results.error.message}</p>;
  }
  if (results.data.length === 0) {
    return <p className="py-10 text-sm text-muted-foreground">No matches.</p>;
  }
  return <ResultList results={results.data} onPick={onPick} />;
}

function useSourceChoice(sources: readonly InstalledSourceView[]) {
  const [chosen, setChosen] = useState("");
  const sourceId = sources.some((source) => source.id === chosen) ? chosen : sources[0]?.id ?? "";
  const options = useMemo(() => sources.map((source) => ({ value: source.id, label: source.name, description: source.lang })), [sources]);
  return { sourceId, options, setChosen };
}

function useFind(sources: readonly InstalledSourceView[]) {
  const { sourceId, options, setChosen } = useSourceChoice(sources);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<SourceResult | null>(null);
  const handleText = useCallback((event: ChangeEvent<HTMLInputElement>) => setText(event.target.value), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPicked(null);
    setQuery(text.trim());
  }, [text]);
  const handleSource = useCallback((id: string) => {
    setChosen(id);
    setPicked(null);
  }, [setChosen]);
  const handleBack = useCallback(() => setPicked(null), []);
  return { sourceId, options, text, query, picked, handlePick: setPicked, handleText, handleSubmit, handleSource, handleBack };
}

function FindBar({ find }: { readonly find: ReturnType<typeof useFind> }): React.JSX.Element {
  return (
    <form onSubmit={find.handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <div className="sm:w-52">
        <SearchableSelect value={find.sourceId} options={find.options} onValueChange={find.handleSource} placeholder="Source" ariaLabel="Source" />
      </div>
      <label className="flex h-10 min-w-0 shrink-0 items-center gap-2 sm:flex-1 rounded-lg border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input value={find.text} onChange={find.handleText} placeholder="Search for a show" aria-label="Search for a show" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <button type="submit" disabled={find.text.trim() === ""} className="h-10 rounded-lg bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50">Search</button>
    </form>
  );
}

export function AdminFind({ showFolders }: { readonly showFolders: readonly string[] }): React.JSX.Element {
  const overview = useSources();
  const sources = overview.data?.sources ?? EMPTY_SOURCES;
  const find = useFind(sources);
  return (
    <AdminPage title="Find">
      {overview.status === "error" && <p className="select-text py-2 text-sm text-destructive">{overview.error.message}</p>}
      {overview.status === "success" && sources.length === 0 && (
        <p className="pb-4 text-sm text-muted-foreground">Add a repository under Sources and install a source to search it.</p>
      )}
      {sources.length > 0 && <FindBar find={find} />}
      <div className="mt-6">
        {find.picked === null
          ? <Results sourceId={find.sourceId} query={find.query} onPick={find.handlePick} />
          : <SourceShowPanel sourceId={find.sourceId} result={find.picked} showFolders={showFolders} onBack={find.handleBack} />}
      </div>
      <SourceManager overview={overview.data} />
    </AdminPage>
  );
}
