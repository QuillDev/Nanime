import { useCallback, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { AniListMedia } from "../types.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { useLinkMetadata, useMetadataSearch } from "../hooks/useShowMetadata.ts";
import { Input } from "./ui/input.tsx";
import { ManualMetadataLink } from "./ManualMetadataLink.tsx";
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
  readonly metadataKey: string;
  readonly suggestedSearch: string;
  readonly subject: "show" | "season";
  readonly onClose: () => void;
}

function useLinkAction(metadataKey: string, onClose: () => void) {
  const link = useLinkMetadata();
  const handleSelect = useCallback((id: number) => {
    link.mutate({ key: metadataKey, id }, { onSuccess: onClose });
  }, [link, metadataKey, onClose]);
  return { link, handleSelect };
}

export function AniListLinkDialog({
  currentMedia,
  metadataKey,
  suggestedSearch,
  subject,
  onClose,
}: AniListLinkDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<string>(suggestedSearch);
  const [searchTerm, setSearchTerm] = useState<string>(suggestedSearch);
  const results = useMetadataSearch(searchTerm);
  const actions = useLinkAction(metadataKey, onClose);
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
            Choose the AniList entry for this local {subject}.
          </DialogDescription>
        </DialogHeader>
        <ManualMetadataLink metadataKey={metadataKey} suggestedTitle={suggestedSearch} initialId={currentMedia?.anilistId} onClose={onClose} />
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={draft}
            onChange={handleDraftChange}
            aria-label="Search AniList"
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
              Searching AniList…
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
                  disabled={actions.link.isPending}
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
