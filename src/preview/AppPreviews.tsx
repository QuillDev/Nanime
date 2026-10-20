import { QueryClientProvider } from "@tanstack/react-query";
import { AdminApp } from "../components/AdminApp.tsx";
import { AgentKeyCreated } from "../components/AgentKeyDialogs.tsx";
import { PageSkeleton } from "../components/PageSkeleton.tsx";
import { Dialog, DialogContent } from "../components/ui/dialog.tsx";
import { ProfileApp } from "../components/ProfileApp.tsx";
import type { AdminTab } from "../hooks/useMediaRoute.ts";
import { adminQueryClient, agentMcp, createdAgentKey } from "./adminFixtures.ts";
import { previewUser } from "./fixtures.ts";
import { profileQueryClient } from "./profileFixtures.ts";

const SKELETON_PAGES = ["home", "show", "results", "profile", "admin"] as const;

const profileClient = profileQueryClient();
const adminClient = adminQueryClient();

export function ProfilePreview(): React.JSX.Element {
  return (
    <QueryClientProvider client={profileClient}>
      <ProfileApp user={previewUser} />
    </QueryClientProvider>
  );
}

function closePreview(): void {}

/** `createdKey` opens the dialog that shows a just-created agent key. */
export function AdminPreview({ tab, createdKey }: { readonly tab: AdminTab; readonly createdKey: boolean }): React.JSX.Element {
  return (
    <QueryClientProvider client={adminClient}>
      <AdminApp user={previewUser} tab={tab} />
      {createdKey && (
        <Dialog open>
          <DialogContent className="max-w-xl">
            <AgentKeyCreated created={createdAgentKey} mcp={agentMcp} origin="https://nanime.example" onDone={closePreview} />
          </DialogContent>
        </Dialog>
      )}
    </QueryClientProvider>
  );
}

export function SkeletonPreview({ page }: { readonly page: string }): React.JSX.Element | null {
  const known = SKELETON_PAGES.find((candidate) => candidate === page);
  return known === undefined ? null : <PageSkeleton page={known} />;
}
