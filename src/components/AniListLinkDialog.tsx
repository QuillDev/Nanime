import { useCallback, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { AniListMedia, MetadataProvider } from "../types.ts";
import { mediaTitle } from "../lib/anilist.ts";
import {
  useLinkMetadata,
  useMetadataSearch,
  useUpdateMetadataAniListId,
} from "../hooks/useShowMetadata.ts";
import { Input } from "./ui/input.tsx";
import { MetadataAniListSyncField } from "./MetadataAniListSyncField.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface SearchResultProps {
  readonly media: AniListMedia;
  readonly disabled: boolean;
  readonly onSelect: (id: number) => void;
}

function SearchResult({ media, disabled, onSelect }: SearchResultProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(media.id);
  }, [media.id, onSelect]);
  const cover = media.coverImage.large ?? media.coverImage.extraLarge;
  const detail = [media.format, media.seasonYear, media.episodes && `${String(media.episodes)} eps`]
    .filter((value) => value !== null)
    .join(" · ");

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        className="flex w-full gap-3 py-3 text-left transition-colors hover:text-primary disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cover !== null && (
          <img src={cover} alt="" className="h-16 w-11 shrink-0 rounded object-cover" />
        )}
        <span className="min-w-0">
          <span className="block font-semibold">{mediaTitle(media)}</span>
          {media.title.english !== media.title.romaji && (
            <span className="mt-1 block text-sm text-muted-foreground">
              {media.title.romaji}
            </span>
          )}
          <span className="mt-1 block text-xs uppercase tracking-wide text-muted-foreground">
            {detail}
          </span>
        </span>
      </button>
    </li>
  );
}

interface AniListLinkDialogProps {
  readonly currentMedia: AniListMedia | undefined;
  readonly initialProvider: MetadataProvider;
  readonly metadataKey: string;
  readonly suggestedSearch: string;
  readonly subject: "show" | "season";
  readonly onClose: () => void;
}

function parsedAniListId(value: string): number | null | undefined {
  if (value.trim() === "") {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function ProviderPicker({
  provider,
  onProvider,
}: {
  readonly provider: MetadataProvider;
  readonly onProvider: (provider: MetadataProvider) => void;
}): React.JSX.Element {
  const handleProvider = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const value = event.currentTarget.dataset["provider"];
    if (value === "anilist" || value === "jikan") {
      onProvider(value);
    }
  }, [onProvider]);
  return (
    <div className="grid grid-cols-2 rounded-md border border-border bg-black p-1">
      {(["anilist", "jikan"] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-provider={value}
          onClick={handleProvider}
          className={value === provider
            ? "rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            : "rounded px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"}
        >
          {value === "anilist" ? "AniList" : "Jikan"}
        </button>
      ))}
    </div>
  );
}

function useAniListIdDraft(initialId: number | null | undefined) {
  const [draft, setDraft] = useState<string>(() => (
    initialId === null || initialId === undefined ? "" : String(initialId)
  ));
  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);
  return { draft, value: parsedAniListId(draft), handleChange };
}

interface LinkActionsOptions {
  readonly anilistId: number | null | undefined;
  readonly metadataKey: string;
  readonly onClose: () => void;
  readonly provider: MetadataProvider;
}

function useLinkActions(options: LinkActionsOptions) {
  const { anilistId, metadataKey, onClose, provider } = options;
  const link = useLinkMetadata();
  const updateAniListId = useUpdateMetadataAniListId();
  const handleSelect = useCallback((id: number) => {
    if (provider === "jikan" && anilistId === undefined) {
      return;
    }
    void (async (): Promise<void> => {
      await link.mutateAsync({
        provider,
        key: metadataKey,
        id,
        anilistId: provider === "jikan" ? anilistId ?? null : null,
      });
      onClose();
    })();
  }, [anilistId, link, metadataKey, onClose, provider]);
  const handleSaveAniListId = useCallback(() => {
    if (anilistId !== undefined) {
      updateAniListId.mutate({ key: metadataKey, anilistId });
    }
  }, [anilistId, metadataKey, updateAniListId]);
  return { link, updateAniListId, handleSelect, handleSaveAniListId };
}

export function AniListLinkDialog({
  currentMedia,
  initialProvider,
  metadataKey,
  suggestedSearch,
  subject,
  onClose,
}: AniListLinkDialogProps): React.JSX.Element {
  const [provider, setProvider] = useState<MetadataProvider>(initialProvider);
  const [draft, setDraft] = useState<string>(suggestedSearch);
  const [searchTerm, setSearchTerm] = useState<string>(suggestedSearch);
  const aniListId = useAniListIdDraft(currentMedia?.anilistId);
  const results = useMetadataSearch(provider, searchTerm);
  const actions = useLinkActions({
    anilistId: aniListId.value,
    metadataKey,
    onClose,
    provider,
  });
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchTerm(draft.trim());
  }, [draft]);
  const handleDraftChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose();
    }
  }, [onClose]);

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match metadata</DialogTitle>
          <DialogDescription>
            Choose one metadata source and entry for this local {subject}.
          </DialogDescription>
        </DialogHeader>
        <ProviderPicker provider={provider} onProvider={setProvider} />
        {provider === "jikan" && (
          <MetadataAniListSyncField
            canSave={currentMedia?.provider === "jikan"}
            draft={aniListId.draft}
            value={aniListId.value}
            pending={actions.updateAniListId.isPending}
            saved={actions.updateAniListId.isSuccess}
            error={actions.updateAniListId.error?.message ?? null}
            onChange={aniListId.handleChange}
            onSave={actions.handleSaveAniListId}
          />
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={draft}
            onChange={handleDraftChange}
            aria-label={`Search ${provider === "anilist" ? "AniList" : "Jikan"}`}
            placeholder="Anime title…"
          />
          <button
            type="submit"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="size-4" />
            <span className="sr-only">Search</span>
          </button>
        </form>
        <div className="max-h-[55vh] overflow-y-auto">
          {results.status === "pending" && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Searching {provider === "anilist" ? "AniList" : "Jikan"}…
            </p>
          )}
          {results.status === "error" && (
            <p className="py-8 text-center text-sm text-destructive">
              {results.error.message}
            </p>
          )}
          {results.status === "success" && results.data.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No matches found.</p>
          )}
          {results.status === "success" && (
            <ul>
              {results.data.map((media) => (
                <SearchResult
                  key={media.id}
                  media={media}
                  disabled={actions.link.isPending || provider === "jikan" && aniListId.value === undefined}
                  onSelect={actions.handleSelect}
                />
              ))}
            </ul>
          )}
          {actions.link.isError && (
            <p className="mt-3 text-sm text-destructive">{actions.link.error.message}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
