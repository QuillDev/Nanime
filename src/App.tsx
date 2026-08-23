import { useCurrentUser } from "./hooks/useAuth.ts";
import { LoginScreen } from "./components/LoginScreen.tsx";
import { MediaApp } from "./components/MediaApp.tsx";

export function App(): React.JSX.Element {
  const currentUser = useCurrentUser();
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
  return currentUser.data === null ? <LoginScreen /> : <MediaApp user={currentUser.data} />;
}
