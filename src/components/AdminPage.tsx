import type { ReactNode } from "react";

/** One admin page: a display heading, optional right-aligned actions, then content. */
export function AdminPage({ title, actions, children }: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <section aria-labelledby="admin-page-title" className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-11 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 id="admin-page-title" className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          {actions}
        </header>
        {children}
      </div>
    </section>
  );
}
