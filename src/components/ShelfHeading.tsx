import { formatCompactCount } from "../format.ts";

interface ShelfHeadingProps {
  readonly count: number;
  readonly pluralLabel?: string;
  readonly singularLabel?: string;
  readonly title: string;
}

export function ShelfHeading({
  count,
  pluralLabel = "titles",
  singularLabel = "title",
  title,
}: ShelfHeadingProps): React.JSX.Element {
  const countLabel = count === 1 ? singularLabel : pluralLabel;
  return (
    <div className="mb-5 flex items-center gap-3">
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums text-muted-foreground"
        aria-label={`${String(count)} ${countLabel}`}
      >
        {formatCompactCount(count)}
      </span>
    </div>
  );
}
