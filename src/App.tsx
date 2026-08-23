import { lazy, Suspense } from "react";
import { useCurrentUser } from "./hooks/useAuth.ts";
import { LoginScreen } from "./components/LoginScreen.tsx";
import {
  navigateToShows,
  useMediaRoute,
  type MediaRoute,
} from "./hooks/useMediaRoute.ts";
import type { AuthUser } from "./types.ts";

const AdminApp = lazy(async () => {
  const module = await import("./components/AdminApp.tsx");
  return { default: module.AdminApp };
});
const MediaApp = lazy(async () => {
  const module = await import("./components/MediaApp.tsx");
  return { default: module.MediaApp };
});
const ProfileApp = lazy(async () => {
  const module = await import("./components/ProfileApp.tsx");
  return { default: module.ProfileApp };
});

function RouteLoading(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      Loading…
    </main>
  );
}

const ROUTE_LOADING = <RouteLoading />;

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
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </main>
    );
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
      {authenticatedView(currentUser.data, route)}
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
