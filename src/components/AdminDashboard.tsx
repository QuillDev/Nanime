import { ShieldCheck } from "lucide-react";
import { AdminAddMedia } from "./AdminAddMedia.tsx";
import { AdminDownloads } from "./AdminDownloads.tsx";
import { AdminUsers } from "./AdminUsers.tsx";

export function AdminDashboard({
  showFolders,
}: {
  readonly showFolders: readonly string[];
}): React.JSX.Element {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 flex items-center gap-4">
        <span className="rounded-xl bg-primary p-3 text-primary-foreground">
          <ShieldCheck className="size-6" />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage downloads, media ingestion, users, and library operations.
          </p>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <AdminAddMedia showFolders={showFolders} />
        <AdminDownloads />
        <AdminUsers />
      </div>
    </main>
  );
}
