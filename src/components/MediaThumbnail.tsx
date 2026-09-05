import { useCallback, useState } from "react";
import { Check, Film } from "lucide-react";
import { thumbnailUrl } from "../api.ts";
import { cn } from "../lib/utils.ts";

interface MediaThumbnailProps {
  readonly rel: string;
  readonly source?: string | null | undefined;
  readonly className?: string;
  readonly watched?: boolean;
}

export function MediaThumbnail({
  rel,
  source,
  className,
  watched = false,
}: MediaThumbnailProps): React.JSX.Element {
  const [failed, setFailed] = useState<boolean>(false);
  const handleError = useCallback(() => {
    setFailed(true);
  }, []);

  return (
    <div
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden bg-secondary",
        className,
      )}
    >
      {failed ? (
        <Film className="size-10 text-primary" />
      ) : (
        <img
          src={source ?? thumbnailUrl(rel)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={handleError}
          className="size-full object-cover"
        />
      )}
      {watched && (
        <>
          <span className="pointer-events-none absolute inset-0 bg-black/50" aria-hidden="true" />
          <span
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-black"
            aria-label="Watched"
            title="Watched"
          >
            <Check className="size-4 stroke-[3]" aria-hidden="true" />
          </span>
        </>
      )}
    </div>
  );
}
