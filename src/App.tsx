import { useCurrentUser } from "./hooks/useAuth.ts";
import { LoginScreen } from "./components/LoginScreen.tsx";
import { MediaApp } from "./components/MediaApp.tsx";
import { AdminApp } from "./components/AdminApp.tsx";
import { navigateToShows, useMediaRoute } from "./hooks/useMediaRoute.ts";
import type { AuthUser } from "./types.ts";

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
  return currentUser.data === null
    ? <LoginScreen />
    : authenticatedView(currentUser.data, route.admin);
}

function authenticatedView(user: AuthUser, adminRoute: boolean): React.JSX.Element {
  if (!adminRoute) {
    return <MediaApp user={user} />;
  }
  return user.isAdmin ? <AdminApp user={user} /> : <AdminForbidden />;
}
