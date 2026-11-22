import type { ArtSources } from "../lib/art.ts";
import { cn } from "../lib/utils.ts";

interface HeroArtProps {
  /** The wide art (a banner or frame) for screens wide enough to show it. */
  readonly wide: ArtSources | null;
  /** On a phone the banner is tall, where wide art would be a thin slice of itself: the poster fits it whole. */
  readonly poster: ArtSources | null;
  /** The wide art is a stand-in that only works blurred. */
  readonly blurred: boolean;
  /** The fade under the copy on wide screens; phones fade up from the bottom. */
  readonly wideFade: string;
}

/** A hero's backdrop and fade: the poster on phones, the wide art everywhere else. */
export function HeroArt({ wide, poster, blurred, wideFade }: HeroArtProps): React.JSX.Element {
  const narrow = poster ?? wide;
  return (
    <>
      {narrow !== null && (
        <picture>
          {wide !== null && <source media="(min-width: 640px)" srcSet={wide.srcSet ?? wide.src} sizes="100vw" />}
          <img
            key={narrow.src}
            src={narrow.src}
            srcSet={narrow.srcSet}
            sizes="100vw"
            fetchPriority="high"
            alt=""
            className={cn("absolute inset-0 size-full object-cover object-top sm:object-[50%_28%]", blurred && "sm:scale-110 sm:blur-md")}
          />
        </picture>
      )}
      <span aria-hidden="true" className={cn("absolute inset-0 hidden sm:block", wideFade)} />
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgb(0_0_0)_0%,rgb(0_0_0/0.85)_28%,rgb(0_0_0/0.25)_58%,transparent_78%),linear-gradient(180deg,rgb(0_0_0/0.5)_0%,transparent_16%)] sm:hidden" />
    </>
  );
}
