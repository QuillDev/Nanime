import { lazy, Suspense } from "react";
import { useCurrentUser } from "./hooks/useAuth.ts";
import { LoginScreen } from "./components/LoginScreen.tsx";
import {
  navigateToShows,
  useMediaRoute,
  type MediaRoute,
} from "./hooks/useMediaRoute.ts";
import type { AuthUser } from "./types.ts";
import {
  loadAdminApp,
  loadMediaApp,
  loadProfileApp,
} from "./routeModules.ts";
import { AppShellSkeleton, SessionSkeleton } from "./components/Skeleton.tsx";
import { SessionProviders } from "./components/SessionProviders.tsx";

const AdminApp = lazy(async () => {
  const module = await loadAdminApp();
  return { default: module.AdminApp };
});
const MediaApp = lazy(async () => {
  const module = await loadMediaApp();
  return { default: module.MediaApp };
});
const ProfileApp = lazy(async () => {
  const module = await loadProfileApp();
  return { default: module.ProfileApp };
});
const ROUTE_LOADING = <AppShellSkeleton />;

function AdminForbidden(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <h1 className="text-2xl font-bold">Administrator access required</h1>
      <p className="text-sm text-muted-foreground">This dashboard is not available to your account.</p>
      <button
        type="button"
        onClick={navigateToShows}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Return to library
      </button>
    </main>
  );
}

export function App(): React.JSX.Element {
  const currentUser = useCurrentUser();
  const route = useMediaRoute();
  if (currentUser.status === "pending") {
    return <SessionSkeleton />;
  }
  if (currentUser.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-destructive">
        Failed to check session: {currentUser.error.message}
      </main>
    );
  }
  if (currentUser.data === null) {
    return <LoginScreen />;
  }
  return (
    <Suspense fallback={ROUTE_LOADING}>
      <SessionProviders key={currentUser.data.id} userId={currentUser.data.id}>
        {authenticatedView(currentUser.data, route)}
      </SessionProviders>
    </Suspense>
  );
}

function authenticatedView(user: AuthUser, route: MediaRoute): React.JSX.Element {
  if (route.admin) {
    return user.isAdmin
      ? <AdminApp user={user} tab={route.adminTab} />
      : <AdminForbidden />;
  }
  return route.profile ? <ProfileApp user={user} /> : <MediaApp user={user} />;
}
