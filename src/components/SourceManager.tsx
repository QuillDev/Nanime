import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import { useSourceChange } from "../hooks/useSources.ts";
import {
  addSourceRepo, installSource, removeSourceRepo, uninstallSource,
  type AvailableSourceView, type SourceRepoView, type SourcesOverview,
} from "../sourcesApi.ts";
import { SourceSettings } from "./SourceSettings.tsx";

const SMALL_BUTTON = "h-8 shrink-0 rounded-md px-3 text-xs font-semibold disabled:opacity-50";

function SourceRow({ source }: { readonly source: AvailableSourceView }): React.JSX.Element {
  const install = useSourceChange(installSource);
  const uninstall = useSourceChange(uninstallSource);
  const installed = source.installedVersion !== null;
  const outdated = installed && source.installedVersion !== source.version;
  const handleInstall = useCallback(() => install.mutate(source.id), [install, source.id]);
  const handleRemove = useCallback(() => uninstall.mutate(source.id), [uninstall, source.id]);
  const error = install.error ?? uninstall.error;
  return (
    <li className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{source.name}</p>
          <p className="text-xs text-muted-foreground">{source.lang} · {source.installedVersion ?? source.version}{source.nsfw ? " · 18+" : ""}</p>
        </div>
        {(!installed || outdated) && (
          <button type="button" onClick={handleInstall} disabled={install.isPending} className={`${SMALL_BUTTON} bg-foreground text-background`}>
            {outdated ? `Update to ${source.version}` : "Install"}
          </button>
        )}
        {installed && (
          <button type="button" onClick={handleRemove} disabled={uninstall.isPending} className={`${SMALL_BUTTON} text-muted-foreground hover:bg-secondary hover:text-foreground`}>
            Remove
          </button>
        )}
      </div>
      {error !== null && <p className="select-text pt-1 text-xs text-destructive">{error.message}</p>}
      {installed && <SourceSettings sourceId={source.id} />}
    </li>
  );
}

function RepoSection({ repo }: { readonly repo: SourceRepoView }): React.JSX.Element {
  const remove = useSourceChange(removeSourceRepo);
  const handleRemove = useCallback(() => remove.mutate(repo.url), [remove, repo.url]);
  return (
    <section className="mt-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <h3 title={repo.url} className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">{repo.url}</h3>
        <button type="button" onClick={handleRemove} disabled={remove.isPending} aria-label={`Remove repository ${repo.url}`} title="Remove repository" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      {repo.error !== null && <p className="select-text py-2 text-sm text-warning">{repo.error}</p>}
      {repo.error === null && repo.sources.length === 0 && <p className="py-2 text-sm text-muted-foreground">No anime sources Nanime can run.</p>}
      <ul>
        {repo.sources.map((source) => <SourceRow key={source.id} source={source} />)}
      </ul>
    </section>
  );
}

function AddRepo(): React.JSX.Element {
  const [url, setUrl] = useState("");
  const add = useSourceChange(addSourceRepo);
  const handleUrl = useCallback((event: ChangeEvent<HTMLInputElement>) => setUrl(event.target.value), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    add.mutate(url.trim(), { onSuccess: () => setUrl("") });
  }, [add, url]);
  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <div className="flex gap-2">
        <input value={url} onChange={handleUrl} type="url" placeholder="Repository index link (…/index.min.json)" aria-label="Repository link" className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        <button type="submit" disabled={url.trim() === "" || add.isPending} className="h-9 rounded-lg bg-foreground px-3.5 text-sm font-semibold text-background disabled:opacity-50">Add</button>
      </div>
      {add.error !== null && <p className="select-text pt-1 text-sm text-destructive">{add.error.message}</p>}
    </form>
  );
}

/** Repositories and their sources, collapsed once something is installed. */
export function SourceManager({ overview }: { readonly overview: SourcesOverview | undefined }): React.JSX.Element | null {
  if (overview === undefined) {
    return null;
  }
  return (
    <details open={overview.sources.length === 0} className="group mt-10 border-t border-border pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-display text-lg font-bold">
        Sources
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <AddRepo />
      {overview.repos.map((repo) => <RepoSection key={repo.url} repo={repo} />)}
    </details>
  );
}
