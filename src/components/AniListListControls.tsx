import { useCallback, type FormEvent } from "react";
import type { AniListMedia, AniListWatchStatus } from "../types.ts";
import {
  useAniListAccount,
  useAniListListEntry,
  useUpdateAniListListEntry,
} from "../hooks/useAniListAccount.ts";
import aniListLogoUrl from "../assets/anilist-logo.svg";
import { Input } from "./ui/input.tsx";

const STATUS_OPTIONS: readonly {
  readonly value: AniListWatchStatus;
  readonly label: string;
}[] = [
  { value: "NONE", label: "None" },
  { value: "CURRENT", label: "Watching" },
  { value: "PLANNING", label: "Planning" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PAUSED", label: "Paused" },
  { value: "DROPPED", label: "Dropped" },
  { value: "REPEATING", label: "Rewatching" },
];

function watchStatus(value: FormDataEntryValue | null): AniListWatchStatus {
  const match = STATUS_OPTIONS.find((option) => option.value === value);
  return match?.value ?? "NONE";
}

function useListControls(mediaId: number) {
  const account = useAniListAccount();
  const connected = account.data?.connected === true;
  const entry = useAniListListEntry(mediaId, connected);
  const update = useUpdateAniListListEntry();
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update.mutate({
      mediaId,
      update: {
        status: watchStatus(form.get("status")),
        progress: Number(form.get("progress")),
        score: Number(form.get("score")),
      },
    });
  }, [mediaId, update]);
  return { connected, entry, update, handleSubmit, mediaId };
}

export function AniListListControls({
  media,
  mediaId,
}: {
  readonly media: AniListMedia;
  readonly mediaId: number;
}): React.JSX.Element | null {
  const { connected, entry, update, handleSubmit } = useListControls(mediaId);
  if (!connected) {
    return null;
  }
  if (entry.status === "pending") {
    return <p className="mt-4 text-sm text-muted-foreground">Loading your AniList status…</p>;
  }
  if (entry.status === "error") {
    return <p className="mt-4 text-sm text-destructive">{entry.error.message}</p>;
  }
  const current = entry.data;
  return (
    <form
      key={`${String(mediaId)}:${current?.status ?? "none"}:${String(current?.progress ?? 0)}:${String(current?.score ?? 0)}`}
      onSubmit={handleSubmit}
      className="mb-4 border-b border-border pb-4"
    >
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-medium text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
          <img src={aniListLogoUrl} alt="" className="size-5" />
          AniList
        </span>
        <label htmlFor={`anilist-status-${String(mediaId)}`} className="inline-flex shrink-0 items-center gap-1.5">
          Status
          <select
            id={`anilist-status-${String(mediaId)}`}
            name="status"
            defaultValue={current?.status ?? "NONE"}
            className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`anilist-progress-${String(mediaId)}`} className="inline-flex shrink-0 items-center gap-1.5">
          Episode
          <Input
            id={`anilist-progress-${String(mediaId)}`}
            name="progress"
            type="number"
            min={0}
            max={media.episodes ?? undefined}
            defaultValue={current?.progress ?? 0}
            className="h-9 w-16"
          />
        </label>
        <label htmlFor={`anilist-score-${String(mediaId)}`} className="inline-flex shrink-0 items-center gap-1.5">
          Score
          <Input
            id={`anilist-score-${String(mediaId)}`}
            name="score"
            type="number"
            min={0}
            max={10}
            step={0.5}
            defaultValue={current?.score ?? 0}
            className="h-9 w-16"
          />
        </label>
        <button
          type="submit"
          disabled={update.isPending}
          className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {update.status === "error" && (
        <p className="mt-2 text-xs text-destructive">{update.error.message}</p>
      )}
    </form>
  );
}
