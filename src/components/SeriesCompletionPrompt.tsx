import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { Star } from "lucide-react";
import type { AniListPlaybackTarget } from "../types.ts";
import {
  useAniListAccount,
  useAniListListEntry,
  useUpdateAniListListEntry,
} from "../hooks/useAniListAccount.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

type CompletionHandler = (target: AniListPlaybackTarget) => void;

const SeriesCompletionContext = createContext<CompletionHandler | null>(null);

export function useSeriesCompletionPrompt(): CompletionHandler {
  const prompt = useContext(SeriesCompletionContext);
  return prompt ?? (() => undefined);
}

function useCompletionEntry(target: AniListPlaybackTarget, onDismiss: () => void) {
  const account = useAniListAccount();
  const connected = account.data?.connected === true;
  const entry = useAniListListEntry(target.mediaId, connected);
  useEffect(() => {
    if (account.status === "success" && !connected) {
      onDismiss();
    }
  }, [account.status, connected, onDismiss]);
  useEffect(() => {
    if (entry.status === "success" && (entry.data?.score ?? 0) > 0) {
      onDismiss();
    }
  }, [entry.data?.score, entry.status, onDismiss]);
  return { connected, entry };
}

function ScoreButton({
  selected,
  value,
  onSelect,
}: {
  readonly selected: boolean;
  readonly value: number;
  readonly onSelect: (score: number) => void;
}): React.JSX.Element {
  const handleClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={handleClick}
      className="aspect-square rounded-lg border border-border bg-background text-sm font-semibold transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
    >
      {value}
    </button>
  );
}

function CompletionDialog({
  target,
  onDismiss,
}: {
  readonly target: AniListPlaybackTarget;
  readonly onDismiss: () => void;
}): React.JSX.Element | null {
  const { connected, entry } = useCompletionEntry(target, onDismiss);
  const update = useUpdateAniListListEntry();
  const [score, setScore] = useState<number | null>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onDismiss();
    }
  }, [onDismiss]);
  const handleSave = useCallback(() => {
    if (score === null) {
      return;
    }
    update.mutate({
      mediaId: target.mediaId,
      update: {
        status: "COMPLETED",
        progress: target.totalEpisodes ?? target.episode,
        score,
      },
    }, { onSuccess: onDismiss });
  }, [onDismiss, score, target.episode, target.mediaId, target.totalEpisodes, update]);

  if (!connected || entry.status === "pending" ||
    entry.status === "success" && (entry.data?.score ?? 0) > 0) {
    return null;
  }
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="z-[70] max-w-md overflow-hidden border-primary/30 bg-card p-0 shadow-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4">
        <div className="bg-gradient-to-br from-primary/20 via-card to-card px-6 pb-5 pt-8">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Star className="size-6 fill-current" />
          </div>
          <DialogHeader>
            <DialogTitle className="pr-10 text-2xl">Series complete</DialogTitle>
            <DialogDescription className="text-base">
              You finished <span className="font-semibold text-foreground">{target.title}</span>.
              What score would you give it?
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-6 pb-6">
          <fieldset className="grid grid-cols-5 gap-2">
            <legend className="sr-only">Score out of 10</legend>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <ScoreButton
                key={value}
                value={value}
                selected={score === value}
                onSelect={setScore}
              />
            ))}
          </fieldset>
          {entry.status === "error" && (
            <p className="mt-3 text-sm text-destructive">Could not check your current score. You can still save a new one.</p>
          )}
          {update.status === "error" && (
            <p className="mt-3 text-sm text-destructive">Could not save that score: {update.error.message}</p>
          )}
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={score === null || update.isPending}
              onClick={handleSave}
              className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm disabled:bg-muted disabled:text-muted-foreground"
            >
              {update.isPending ? "Saving…" : "Save score"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SeriesCompletionProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [target, setTarget] = useState<AniListPlaybackTarget | null>(null);
  const prompt = useCallback((completed: AniListPlaybackTarget) => {
    if (completed.totalEpisodes !== null && completed.episode >= completed.totalEpisodes) {
      setTarget(completed);
    }
  }, []);
  const dismiss = useCallback(() => setTarget(null), []);
  return (
    <SeriesCompletionContext.Provider value={prompt}>
      {children}
      {target !== null && <CompletionDialog target={target} onDismiss={dismiss} />}
    </SeriesCompletionContext.Provider>
  );
}
