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
    <section className={`rounded-xl border border-border bg-card p-6 ${className}`}>
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-md bg-primary p-2 text-primary-foreground">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
