import { lazy, Suspense } from "react";
import type { AdminTab } from "../hooks/useMediaRoute.ts";
import type { MediaEntry, ShowMetadata } from "../types.ts";
import { AdminDownloads } from "./AdminDownloads.tsx";
import { AdminPage } from "./AdminPage.tsx";
import { AdminSidebar } from "./AdminSidebar.tsx";
import { AdminSystem, AdminVideoManagement } from "./AdminSystem.tsx";
import { AdminTranscodes } from "./AdminTranscodes.tsx";
import { AdminUsers } from "./AdminUsers.tsx";
import { ListSkeleton } from "./Skeleton.tsx";

// The file manager package and its stylesheet load only when the Files page opens.
const AdminLibraryFiles = lazy(async () => {
  const module = await import("./AdminLibraryFiles.tsx");
  return { default: module.AdminLibraryFiles };
});
const FILES_LOADING = <ListSkeleton rows={6} />;
const AdminFind = lazy(async () => {
  const module = await import("./AdminFind.tsx");
  return { default: module.AdminFind };
});

interface AdminContentProps {
  readonly showFolders: readonly string[];
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly tab: AdminTab;
}

function AdminContent({ showFolders, entries, metadata, tab }: AdminContentProps): React.JSX.Element {
  switch (tab) {
    case "find": {
      return (
        <Suspense fallback={FILES_LOADING}>
          <AdminFind showFolders={showFolders} />
        </Suspense>
      );
    }
    case "downloads": {
      return <AdminDownloads showFolders={showFolders} metadata={metadata} />;
    }
    case "transcodes": {
      return <AdminTranscodes />;
    }
    case "files": {
      return (
        <AdminPage title="Files">
          <Suspense fallback={FILES_LOADING}>
            <AdminLibraryFiles />
          </Suspense>
        </AdminPage>
      );
    }
    case "videos": {
      return <AdminPage title="Videos"><AdminVideoManagement entries={entries} metadata={metadata} /></AdminPage>;
    }
    case "users": {
      return <AdminUsers />;
    }
    case "system": {
      return <AdminSystem />;
    }
  }
}

export function AdminDashboard(props: AdminContentProps): React.JSX.Element {
  return (
    <main className="flex flex-col lg:flex-row">
      <AdminSidebar tab={props.tab} />
      <AdminContent showFolders={props.showFolders} entries={props.entries} metadata={props.metadata} tab={props.tab} />
    </main>
  );
}
