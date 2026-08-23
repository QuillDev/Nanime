import type { AuthUser } from "../types.ts";
import { sourceShowFolders } from "../lib/library.ts";
import { useLibrary } from "../hooks/useLibrary.ts";
import { AdminDashboard } from "./AdminDashboard.tsx";
import { MediaHeader } from "./MediaHeader.tsx";

export function AdminApp({ user }: { readonly user: AuthUser }): React.JSX.Element {
  const library = useLibrary();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MediaHeader user={user} view="admin" />
      <AdminDashboard showFolders={sourceShowFolders(library.data ?? [])} />
    </div>
  );
}
