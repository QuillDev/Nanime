import { useCallback, useState } from "react";
import { CircleAlert, Link } from "lucide-react";
import { showMetadataKey, type ShowGroup } from "../lib/library.ts";
import { AniListLinkDialog } from "./AniListLinkDialog.tsx";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible.tsx";

interface MappingRowProps {
  readonly show: ShowGroup;
  readonly onSelect: (show: ShowGroup) => void;
}

function MappingRow({ show, onSelect }: MappingRowProps): React.JSX.Element {
  const handleSelect = useCallback(() => {
    onSelect(show);
  }, [onSelect, show]);
  return (
    <li className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{show.name}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {show.entries.length} {show.entries.length === 1 ? "video" : "videos"}
        </span>
      </span>
      <button
        type="button"
        onClick={handleSelect}
        className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Link className="size-4" />
        Match
      </button>
    </li>
  );
}

interface UnmappedShowsNoticeProps {
  readonly shows: readonly ShowGroup[];
}

export function UnmappedShowsNotice({
  shows,
}: UnmappedShowsNoticeProps): React.JSX.Element | null {
  const [selected, setSelected] = useState<ShowGroup | null>(null);
  const handleSelect = useCallback((show: ShowGroup) => {
    setSelected(show);
  }, []);
  const handleClose = useCallback(() => {
    setSelected(null);
  }, []);
  if (shows.length === 0) {
    return null;
  }
  return (
    <>
      <Collapsible asChild>
        <section className="mb-8 rounded-lg border border-primary bg-card p-4">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                {shows.length} {shows.length === 1 ? "show needs" : "shows need"} metadata
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These local shows remain hidden until an administrator matches them.
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-black px-3 py-2 text-sm font-semibold hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Review
                <CollapsibleChevron />
              </button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <ul className="mt-4 max-h-80 overflow-y-auto border-t border-border pt-1">
              {shows.map((show) => (
                <MappingRow key={show.name} show={show} onSelect={handleSelect} />
              ))}
            </ul>
          </CollapsibleContent>
        </section>
      </Collapsible>
      {selected !== null && (
        <AniListLinkDialog
          currentMedia={undefined}
          initialProvider="anilist"
          metadataKey={showMetadataKey(selected.name)}
          suggestedSearch={selected.name}
          subject="show"
          onClose={handleClose}
        />
      )}
    </>
  );
}
