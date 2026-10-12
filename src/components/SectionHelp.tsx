import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

export function SectionHelp({ label, children }: { readonly label: string; readonly children: ReactNode }): React.JSX.Element {
  return (
    <details className="relative shrink-0 open:z-30">
      <summary aria-label={label} className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <CircleHelp aria-hidden="true" className="size-4" />
      </summary>
      <div className="absolute right-0 top-10 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-lg">
        {children}
      </div>
    </details>
  );
}
