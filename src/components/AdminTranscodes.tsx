import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Film } from "lucide-react";
import { formatDuration, formatSize } from "../api.ts";
import { useCancelTranscode, useDeleteTranscode, useStartTranscode, useTranscodes } from "../hooks/useTranscodes.ts";
import type { MediaEntry, TranscodeJob, TranscodePreset } from "../types.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { SearchableSelect, type SearchableSelectOption } from "./ui/SearchableSelect.tsx";
import { groupShows } from "../lib/library.ts";
import { episodeNumber } from "../lib/anilist.ts";

const PRESETS = {
  "space-saver": { name: "Space Saver", detail: "AV1 10-bit + Opus · smallest files" },
  compatibility: { name: "Compatibility", detail: "H.264 + AAC · widest playback support" },
} as const;

type TranscodeScope = "episode" | "season";

function transcodeChoices(entries: readonly MediaEntry[]) {
  const shows = groupShows(entries);
  const episodes = shows.flatMap((show) => show.seasons.flatMap((season) => (
    season.entries.map((entry) => {
      const episode = episodeNumber(entry);
      return {
        value: entry.rel,
        label: show.name,
        description: `${season.name} · ${episode === null ? entry.name : `Episode ${String(episode)}`} · ${formatSize(entry.size)}`,
        keywords: `${entry.name} ${entry.folder}`,
      };
    })
  )));
  const seasons = shows.flatMap((show) => show.seasons.map((season) => ({
    option: {
      value: `${show.name}\0${season.sourceShow}\0${season.name}`,
      label: show.name,
      description: `${season.name} · ${String(season.entries.length)} episodes · ${formatSize(season.entries.reduce((total, entry) => total + entry.size, 0))}`,
      keywords: `${season.sourceShow} ${season.entries.map((entry) => entry.name).join(" ")}`,
    },
    paths: season.entries.map((entry) => entry.rel),
  })));
  return { episodes, seasons };
}

function useTranscodeSelection(entries: readonly MediaEntry[]) {
  const [scope, setScope] = useState<TranscodeScope>("episode");
  const [selection, setSelection] = useState("");
  const choices = useMemo(() => transcodeChoices(entries), [entries]);
  const seasonOptions = useMemo(() => choices.seasons.map((season) => season.option), [choices]);
  const handleScope = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setScope(event.target.value as TranscodeScope);
    setSelection("");
  }, []);
  return { scope, selection, setSelection, choices, seasonOptions, handleScope };
}

function submitLabel(scope: TranscodeScope, pending: boolean): string {
  if (pending) {
    return "Queueing…";
  }
  return scope === "season" ? "Queue season" : "Create optimized copy";
}

function progressDetail(job: TranscodeJob): string {
  if (job.status !== "processing") {
    return job.status;
  }
  const percent = job.progress * 100;
  const elapsed = job.startedAt === null ? 0 : (Date.now() - job.startedAt) / 1000;
  const remaining = job.progress > 0 ? elapsed / job.progress * (1 - job.progress) : 0;
  const speed = job.speed > 0 ? ` · ${job.speed.toFixed(2)}x` : "";
  const eta = remaining > 0 ? ` · ${formatDuration(remaining)} remaining` : "";
  return `${percent.toFixed(1)}%${speed}${eta}`;
}

function JobRow({ job, media }: { readonly job: TranscodeJob; readonly media: SearchableSelectOption | undefined }): React.JSX.Element {
  const remove = useDeleteTranscode(false);
  const removeOriginal = useDeleteTranscode(true);
  const cancel = useCancelTranscode();
  const saved = job.outputSize === null ? null : job.inputSize - job.outputSize;
  const handleRemove = useCallback(() => remove.mutate(job.id), [job.id, remove]);
  const handleOriginal = useCallback(() => removeOriginal.mutate(job.id), [job.id, removeOriginal]);
  const handleCancel = useCallback(() => cancel.mutate(job.id), [cancel, job.id]);
  return (
    <li className="flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{media?.label ?? job.sourcePath}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {media?.description === undefined ? "" : `${media.description} · `}{PRESETS[job.preset].name} · {progressDetail(job)}
          {saved !== null && saved > 0 ? ` · ${formatSize(saved)} saved` : ""}
        </p>
        {job.status === "processing" && (
          <progress aria-label={`${media?.label ?? job.sourcePath} transcode progress`} value={job.progress} max={1} className="playback-progress mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full" />
        )}
        {job.error !== null && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
      </div>
      {(job.status === "queued" || job.status === "processing") && (
        <button type="button" onClick={handleCancel} disabled={cancel.isPending} className="h-9 shrink-0 rounded-md border border-destructive px-3 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50">
          {cancel.isPending ? "Cancelling…" : "Cancel"}
        </button>
      )}
      {!job.originalDeleted && job.status === "complete" && (
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={handleRemove} disabled={remove.isPending} className="h-9 rounded-md border border-border px-3 text-xs hover:bg-accent">Delete optimized</button>
          <button type="button" onClick={handleOriginal} disabled={removeOriginal.isPending} className="h-9 rounded-md bg-destructive px-3 text-xs font-semibold text-destructive-foreground">Delete original</button>
        </div>
      )}
    </li>
  );
}

export function AdminTranscodes({ entries, hideForm = false }: { readonly entries: readonly MediaEntry[]; readonly hideForm?: boolean }): React.JSX.Element {
  const selectionState = useTranscodeSelection(entries);
  const { scope, selection, setSelection, choices, seasonOptions, handleScope } = selectionState;
  const [preset, setPreset] = useState<TranscodePreset>("space-saver");
  const transcodes = useTranscodes();
  const start = useStartTranscode();
  const handlePreset = useCallback((event: ChangeEvent<HTMLInputElement>) => setPreset(event.target.value as TranscodePreset), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const paths = scope === "episode"
      ? [selection]
      : choices.seasons.find((season) => season.option.value === selection)?.paths ?? [];
    if (selection !== "" && paths.length > 0) {
      start.mutate({ paths, preset }, { onSuccess: () => setSelection("") });
    }
  }, [choices.seasons, preset, scope, selection, setSelection, start]);
  return (
    <AdminPanel title="Media processing" description="Create an optimized copy without touching the raw." icon={Film}>
      {!hideForm && <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset className="flex gap-1 rounded-md border border-border bg-background p-1">
          <legend className="sr-only">Transcode scope</legend>
          {(["episode", "season"] as const).map((value) => (
            <label key={value} className={scope === value ? "flex-1 cursor-pointer rounded-sm bg-primary px-3 py-2 text-center text-sm font-semibold capitalize text-primary-foreground" : "flex-1 cursor-pointer rounded-sm px-3 py-2 text-center text-sm capitalize text-muted-foreground hover:bg-accent hover:text-foreground"}>
              <input type="radio" name="scope" value={value} checked={scope === value} onChange={handleScope} className="sr-only" />
              {value}
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <p className="text-sm font-medium">{scope === "episode" ? "Video" : "Season"}</p>
          <SearchableSelect value={selection} options={scope === "episode" ? choices.episodes : seasonOptions} onValueChange={setSelection} placeholder={scope === "episode" ? "Choose a library episode…" : "Choose a library season…"} searchPlaceholder="Search shows or seasons…" emptyText="No library media match." ariaLabel={scope === "episode" ? "Video to transcode" : "Season to transcode"} />
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Preset</legend>
          {(Object.entries(PRESETS) as [TranscodePreset, typeof PRESETS[TranscodePreset]][]).map(([value, copy]) => (
            <label key={value} aria-label={copy.name} className="flex cursor-pointer gap-3 rounded-md border border-border bg-background p-3">
              <input type="radio" name="preset" value={value} checked={preset === value} onChange={handlePreset} className="mt-0.5 accent-primary" />
              <span><span className="block text-sm font-medium">{copy.name}</span><span className="text-xs text-muted-foreground">{copy.detail}</span></span>
            </label>
          ))}
        </fieldset>
        {start.error !== null && <p className="text-sm text-destructive">{start.error.message}</p>}
        <button type="submit" disabled={selection === "" || start.isPending} className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{submitLabel(scope, start.isPending)}</button>
      </form>}
      {transcodes.data !== undefined && transcodes.data.length > 0 && <ul className="mt-5">{transcodes.data.map((job) => <JobRow key={job.id} job={job} media={choices.episodes.find((option) => option.value === job.sourcePath)} />)}</ul>}
    </AdminPanel>
  );
}
