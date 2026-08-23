import type { ChangeEventHandler } from "react";
import { Input } from "./ui/input.tsx";

interface MetadataAniListSyncFieldProps {
  readonly canSave: boolean;
  readonly draft: string;
  readonly error: string | null;
  readonly pending: boolean;
  readonly saved: boolean;
  readonly value: number | null | undefined;
  readonly onChange: ChangeEventHandler<HTMLInputElement>;
  readonly onSave: () => void;
}

export function MetadataAniListSyncField({
  canSave,
  draft,
  error,
  pending,
  saved,
  value,
  onChange,
  onSave,
}: MetadataAniListSyncFieldProps): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-black p-3">
      <label htmlFor="metadata-anilist-id" className="text-sm font-semibold">
        AniList ID for watch sync <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id="metadata-anilist-id"
          type="number"
          min={1}
          step={1}
          value={draft}
          onChange={onChange}
          placeholder="e.g. 123456"
        />
        {canSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={value === undefined || pending}
            className="shrink-0 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            {pending ? "Saving…" : "Save ID"}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Find this in the AniList URL, such as anilist.co/anime/123456.
      </p>
      {value === undefined && (
        <p className="mt-2 text-xs text-destructive">Enter a positive whole number.</p>
      )}
      {saved && <p className="mt-2 text-xs text-primary">AniList sync ID saved.</p>}
      {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
