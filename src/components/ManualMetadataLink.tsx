import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { useLinkMetadata } from "../hooks/useShowMetadata.ts";

interface Props {
  readonly metadataKey: string;
  readonly suggestedTitle: string;
  readonly initialId: number | null | undefined;
  readonly onClose: () => void;
}
export function ManualMetadataLink({ metadataKey, suggestedTitle, initialId, onClose }: Props): React.JSX.Element {
  const link = useLinkMetadata();
  const [title, setTitle] = useState(suggestedTitle);
  const [id, setId] = useState(initialId === null || initialId === undefined ? "" : String(initialId));
  const handleTitle = useCallback((event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value), []);
  const handleId = useCallback((event: ChangeEvent<HTMLInputElement>) => setId(event.target.value), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const mediaId = Number(id);
    if (!Number.isSafeInteger(mediaId) || mediaId <= 0 || title.trim() === "") { return; }
    link.mutate({ key: metadataKey, id: mediaId, manualTitle: title.trim() }, { onSuccess: onClose });
  }, [id, title, link, metadataKey, onClose]);
  return <details className="rounded border border-border p-3">
    <summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-primary">Link manually (no API)</summary>
    <form onSubmit={handleSubmit} className="mt-3 grid gap-3">
      <p className="text-sm text-muted-foreground">Save a title and AniList anime ID without contacting a metadata provider. The ID is not verified. You can refresh artwork and episode details when the API recovers; AniList progress sync still requires its API.</p>
      <label className="grid gap-1 text-sm">Title<input value={title} onChange={handleTitle} required maxLength={300} className="rounded border border-border bg-black p-2" /></label>
      <label className="grid gap-1 text-sm">AniList anime ID<input type="number" min={1} step={1} value={id} onChange={handleId} required className="rounded border border-border bg-black p-2" /></label>
      <button type="submit" disabled={link.isPending} className="rounded bg-primary p-2 text-primary-foreground">{link.isPending ? "Saving…" : "Save manual mapping"}</button>
      {link.error !== null && <p role="alert" className="text-sm text-destructive">{link.error.message}</p>}
    </form>
  </details>;
}
