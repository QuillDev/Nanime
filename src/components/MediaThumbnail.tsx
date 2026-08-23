import { useCallback, useState } from "react";
import { Film } from "lucide-react";
import { thumbnailUrl } from "../api.ts";
import { cn } from "../lib/utils.ts";

interface MediaThumbnailProps {
  readonly rel: string;
  readonly source?: string | null | undefined;
  readonly className?: string;
}

export function MediaThumbnail({
  rel,
  source,
  className,
}: MediaThumbnailProps): React.JSX.Element {
  const [failed, setFailed] = useState<boolean>(false);
  const handleError = useCallback(() => {
    setFailed(true);
  }, []);

  return (
    <div
      className={cn(
        "flex aspect-video items-center justify-center overflow-hidden bg-secondary",
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
    </div>
  );
}
