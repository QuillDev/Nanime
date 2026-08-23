import type { AuthUser } from "../types.ts";
import { sourceShowFolders } from "../lib/library.ts";
import { useLibrary } from "../hooks/useLibrary.ts";
import { useShowMetadata } from "../hooks/useShowMetadata.ts";
import type { AdminTab } from "../hooks/useMediaRoute.ts";
import { AdminDashboard } from "./AdminDashboard.tsx";
import { MediaHeader } from "./MediaHeader.tsx";

const EMPTY_LIBRARY: readonly never[] = [];
const EMPTY_METADATA = {};

export function AdminApp({
  user,
  tab,
}: {
  readonly user: AuthUser;
  readonly tab: AdminTab;
}): React.JSX.Element {
  const library = useLibrary();
  const metadata = useShowMetadata();
  const entries = library.data ?? EMPTY_LIBRARY;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MediaHeader user={user} view="admin" />
      <AdminDashboard entries={entries} metadata={metadata.data ?? EMPTY_METADATA} showFolders={sourceShowFolders(entries)} tab={tab} />
    </div>
  );
}
