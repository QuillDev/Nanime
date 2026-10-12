import { lazy, Suspense, useCallback } from "react";
import { Download, Film, FolderTree, Server, Users } from "lucide-react";
import { navigateToAdminTab, type AdminTab } from "../hooks/useMediaRoute.ts";
import { AdminAddMedia } from "./AdminAddMedia.tsx";
import { AdminDownloads } from "./AdminDownloads.tsx";
import { AdminSystem, AdminVideoManagement } from "./AdminSystem.tsx";
import type { MediaEntry, ShowMetadata } from "../types.ts";
import { AdminUploadMedia } from "./AdminUploadMedia.tsx";
import { AdminUsers } from "./AdminUsers.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/Tabs.tsx";

// The file manager package and its stylesheet load only when the Files tab opens.
const AdminLibraryFiles = lazy(async () => {
  const module = await import("./AdminLibraryFiles.tsx");
  return { default: module.AdminLibraryFiles };
});
const FILES_LOADING = <p className="py-10 text-center text-sm text-muted-foreground">Loading library files…</p>;

export function AdminDashboard({
  showFolders,
  entries,
  metadata,
  tab,
}: {
  readonly showFolders: readonly string[];
  readonly entries: readonly MediaEntry[];
  readonly metadata: ShowMetadata;
  readonly tab: AdminTab;
}): React.JSX.Element {
  const handleTabChange = useCallback((value: string) => {
    if (value === "downloads" || value === "files" || value === "videos" || value === "users" || value === "system") {
      navigateToAdminTab(value);
    }
  }, []);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto">
        <TabsList aria-label="Administration sections" className="grid w-full grid-cols-[repeat(5,minmax(max-content,1fr))] gap-0.5 sm:inline-grid sm:w-auto sm:gap-1 [&_[data-slot=tabs-trigger]]:px-1 sm:[&_[data-slot=tabs-trigger]]:px-4 [&_svg]:hidden sm:[&_svg]:block">
          <TabsTrigger value="downloads">
            <Download aria-hidden="true" className="size-4" />
            Download
          </TabsTrigger>
          <TabsTrigger value="files">
            <FolderTree aria-hidden="true" className="size-4" />
            Files
          </TabsTrigger>
          <TabsTrigger value="videos">
            <Film aria-hidden="true" className="size-4" />
            Videos
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users aria-hidden="true" className="size-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="system">
            <Server aria-hidden="true" className="size-4" />
            System
          </TabsTrigger>
        </TabsList>
        </div>
        <TabsContent value="downloads">
          <div className="grid items-start gap-4 xl:grid-cols-5">
            <AdminAddMedia showFolders={showFolders} />
            <AdminDownloads />
            <AdminUploadMedia showFolders={showFolders} />
          </div>
        </TabsContent>
        <TabsContent value="files">
          <Suspense fallback={FILES_LOADING}>
            <AdminLibraryFiles />
          </Suspense>
        </TabsContent>
        <TabsContent value="users">
          <AdminUsers />
        </TabsContent>
        <TabsContent value="videos">
          <AdminVideoManagement entries={entries} metadata={metadata} />
        </TabsContent>
        <TabsContent value="system">
          <AdminSystem />
        </TabsContent>
      </Tabs>
    </main>
  );
}
