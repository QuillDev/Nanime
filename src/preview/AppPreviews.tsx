import { QueryClientProvider } from "@tanstack/react-query";
import { AdminApp } from "../components/AdminApp.tsx";
import { PageSkeleton } from "../components/PageSkeleton.tsx";
import { ProfileApp } from "../components/ProfileApp.tsx";
import type { AdminTab } from "../hooks/useMediaRoute.ts";
import { adminQueryClient } from "./adminFixtures.ts";
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

export function AdminPreview({ tab }: { readonly tab: AdminTab }): React.JSX.Element {
  return (
    <QueryClientProvider client={adminClient}>
      <AdminApp user={previewUser} tab={tab} />
    </QueryClientProvider>
  );
}

export function SkeletonPreview({ page }: { readonly page: string }): React.JSX.Element | null {
  const known = SKELETON_PAGES.find((candidate) => candidate === page);
  return known === undefined ? null : <PageSkeleton page={known} />;
}
