import { useCallback } from "react";
import { Download, Film, Server, Users } from "lucide-react";
import { navigateToAdminTab, type AdminTab } from "../hooks/useMediaRoute.ts";
import { AdminAddMedia } from "./AdminAddMedia.tsx";
import { AdminDownloads } from "./AdminDownloads.tsx";
import { AdminSystem, AdminVideoManagement } from "./AdminSystem.tsx";
import type { MediaEntry, ShowMetadata } from "../types.ts";
import { AdminUploadMedia } from "./AdminUploadMedia.tsx";
import { AdminUsers } from "./AdminUsers.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/Tabs.tsx";

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
    if (value === "downloads" || value === "videos" || value === "users" || value === "system") {
      navigateToAdminTab(value);
    }
  }, []);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList aria-label="Administration sections" className="grid w-full grid-cols-4 sm:inline-grid sm:w-auto">
          <TabsTrigger value="downloads">
            <Download aria-hidden="true" className="size-4" />
            Download
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
        <TabsContent value="downloads">
          <div className="grid items-start gap-4 xl:grid-cols-5">
            <AdminAddMedia showFolders={showFolders} />
            <AdminDownloads />
            <AdminUploadMedia showFolders={showFolders} />
          </div>
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
