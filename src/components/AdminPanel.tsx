import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <Icon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
