import { QueryClientProvider } from "@tanstack/react-query";
import { AdminApp } from "../components/AdminApp.tsx";
import { ProfileApp } from "../components/ProfileApp.tsx";
import type { AdminTab } from "../hooks/useMediaRoute.ts";
import { adminQueryClient } from "./adminFixtures.ts";
import { previewUser } from "./fixtures.ts";
import { profileQueryClient } from "./profileFixtures.ts";

const profileClient = profileQueryClient();
const adminClient = adminQueryClient();

export function ProfilePreview(): React.JSX.Element {
  return (
    <QueryClientProvider client={profileClient}>
      <ProfileApp user={previewUser} />
    </QueryClientProvider>
  );
}

export function AdminPreview({ tab }: { readonly tab: AdminTab }): React.JSX.Element {
  return (
    <QueryClientProvider client={adminClient}>
      <AdminApp user={previewUser} tab={tab} />
    </QueryClientProvider>
  );
}
