import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SectionHelp } from "./SectionHelp.tsx";

interface AdminPanelProps {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
  readonly className?: string;
}

export function AdminPanel({
  title,
  description,
  icon: Icon,
  children,
  className = "",
}: AdminPanelProps): React.JSX.Element {
  return (
    <section className={`rounded-lg border border-border bg-card ${className}`}>
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        <SectionHelp label={`About ${title}`}>{description}</SectionHelp>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
