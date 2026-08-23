import { useCallback, type FormEvent } from "react";
import type { AniListMedia, AniListWatchStatus } from "../types.ts";
import {
  useAniListAccount,
  useAniListListEntry,
  useUpdateAniListListEntry,
} from "../hooks/useAniListAccount.ts";
import { Input } from "./ui/input.tsx";

const STATUS_OPTIONS: readonly {
  readonly value: AniListWatchStatus;
  readonly label: string;
}[] = [
  { value: "CURRENT", label: "Watching" },
  { value: "PLANNING", label: "Planning" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PAUSED", label: "Paused" },
  { value: "DROPPED", label: "Dropped" },
  { value: "REPEATING", label: "Rewatching" },
];

function watchStatus(value: FormDataEntryValue | null): AniListWatchStatus {
  const match = STATUS_OPTIONS.find((option) => option.value === value);
  return match?.value ?? "CURRENT";
}

function useListControls(media: AniListMedia): {
  readonly connected: boolean;
  readonly entry: ReturnType<typeof useAniListListEntry>;
  readonly update: ReturnType<typeof useUpdateAniListListEntry>;
  readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
} {
  const account = useAniListAccount();
  const connected = account.data?.connected === true;
  const entry = useAniListListEntry(media.id, connected);
  const update = useUpdateAniListListEntry();
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    update.mutate({
      mediaId: media.id,
      update: {
        status: watchStatus(form.get("status")),
        progress: Number(form.get("progress")),
        score: Number(form.get("score")),
      },
    });
  }, [media.id, update]);
  return { connected, entry, update, handleSubmit };
}

export function AniListListControls({ media }: { readonly media: AniListMedia }): React.JSX.Element | null {
  const { connected, entry, update, handleSubmit } = useListControls(media);
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
      key={`${String(media.id)}:${current?.status ?? "none"}:${String(current?.progress ?? 0)}:${String(current?.score ?? 0)}`}
      onSubmit={handleSubmit}
      className="mt-5 border-t border-border pt-4"
    >
      <p className="mb-3 text-sm font-semibold">Your AniList</p>
      <label htmlFor={`anilist-status-${String(media.id)}`} className="mb-3 block text-xs font-medium text-muted-foreground">
        Status
        <select
          id={`anilist-status-${String(media.id)}`}
          name="status"
          defaultValue={current?.status ?? "PLANNING"}
          className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={`anilist-progress-${String(media.id)}`} className="text-xs font-medium text-muted-foreground">
          Episodes
          <Input
            id={`anilist-progress-${String(media.id)}`}
            name="progress"
            type="number"
            min={0}
            max={media.episodes ?? undefined}
            defaultValue={current?.progress ?? 0}
            className="mt-1.5 h-9"
          />
        </label>
        <label htmlFor={`anilist-score-${String(media.id)}`} className="text-xs font-medium text-muted-foreground">
          Score / 10
          <Input
            id={`anilist-score-${String(media.id)}`}
            name="score"
            type="number"
            min={0}
            max={10}
            step={0.5}
            defaultValue={current?.score ?? 0}
            className="mt-1.5 h-9"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={update.isPending}
        className="mt-3 w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
      >
        {update.isPending ? "Saving…" : "Save to AniList"}
      </button>
      {update.status === "error" && (
        <p className="mt-2 text-xs text-destructive">{update.error.message}</p>
      )}
    </form>
  );
}
