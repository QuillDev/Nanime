import {
  useCallback,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Input } from "./ui/input.tsx";
import { useLogin, useSetupPassword } from "../hooks/useAuth.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { Link2 } from "lucide-react";
import { useAniListAuthConfig } from "../hooks/useAniListAccount.ts";

const OAUTH_ERRORS: Readonly<Record<string, string>> = {
  "invalid-state": "The AniList sign-in response could not be verified. Please try again.",
  "expired-state": "The AniList sign-in request expired. Please try again.",
  "not-linked": "That AniList account is not linked to a provisioned Nanime user.",
  "already-linked": "That AniList account is already linked to another user.",
  failed: "AniList sign-in failed. Please try again.",
};

function useTextField(): readonly [string, (event: ChangeEvent<HTMLInputElement>) => void] {
  const [value, setValue] = useState<string>("");
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  }, []);
  return [value, handleChange];
}

function useAuthenticationMutations(): {
  readonly login: ReturnType<typeof useLogin>;
  readonly setup: ReturnType<typeof useSetupPassword>;
} {
  return {
    login: useLogin(),
    setup: useSetupPassword(),
  };
}

function authenticationStatus(
  login: ReturnType<typeof useLogin>,
  setup: ReturnType<typeof useSetupPassword>,
): { readonly error: Error | null; readonly pending: boolean } {
  return {
    error: login.error ?? setup.error,
    pending: login.isPending || setup.isPending,
  };
}

function authenticationLabel(setupMode: boolean, pending: boolean): string {
  if (pending) {
    return "Please wait…";
  }
  return setupMode ? "Activate account" : "Sign in";
}

function useCredentialFields(): {
  readonly username: ReturnType<typeof useTextField>;
  readonly password: ReturnType<typeof useTextField>;
  readonly confirmation: ReturnType<typeof useTextField>;
  readonly setupToken: ReturnType<typeof useTextField>;
} {
  const username = useTextField();
  const password = useTextField();
  const confirmation = useTextField();
  const setupToken = useTextField();
  return { username, password, confirmation, setupToken };
}

function useLoginForm(): {
  readonly fields: ReturnType<typeof useCredentialFields>;
  readonly setupMode: boolean;
  readonly error: Error | null;
  readonly pending: boolean;
  readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly handleModeChange: () => void;
} {
  const fields = useCredentialFields();
  const [setupMode, setSetupMode] = useState<boolean>(false);
  const { login, setup } = useAuthenticationMutations();
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupMode) {
      if (fields.password[0] === fields.confirmation[0]) {
        setup.mutate({
          username: fields.username[0],
          password: fields.password[0],
          setupToken: fields.setupToken[0],
        });
      }
    } else {
      login.mutate({ username: fields.username[0], password: fields.password[0] });
    }
  }, [fields, login, setup, setupMode]);
  const handleModeChange = useCallback(() => setSetupMode((current) => !current), []);
  const status = authenticationStatus(login, setup);
  return { fields, setupMode, ...status, handleSubmit, handleModeChange };
}

function currentOAuthError(): string | undefined {
  const result = new URLSearchParams(globalThis.location.search).get("anilist");
  return result === null ? undefined : OAUTH_ERRORS[result];
}

export function LoginScreen(): React.JSX.Element {
  const { fields, setupMode, error, pending, handleSubmit, handleModeChange } = useLoginForm();
  const [username, handleUsernameChange] = fields.username;
  const [password, handlePasswordChange] = fields.password;
  const [confirmation, handleConfirmationChange] = fields.confirmation;
  const [setupToken, handleSetupTokenChange] = fields.setupToken;
  const aniListConfig = useAniListAuthConfig();
  const oauthError = currentOAuthError();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-8"
      >
        <div className="mb-8">
          <BrandLogo className="mb-2 h-9 w-auto" />
          <div>
            <p className="text-sm text-muted-foreground">
              {setupMode ? "Activate your provisioned account" : "Sign in to continue"}
            </p>
          </div>
        </div>
        <label htmlFor="login-username" className="mb-4 block text-sm font-medium">
          Username
          <Input
            id="login-username"
            autoComplete="username"
            value={username}
            onChange={handleUsernameChange}
            className="mt-2"
          />
        </label>
        {setupMode && (
          <label htmlFor="login-setup-token" className="mb-4 block text-sm font-medium">
            One-time setup code
            <Input
              type="password"
              id="login-setup-token"
              autoComplete="one-time-code"
              value={setupToken}
              onChange={handleSetupTokenChange}
              className="mt-2"
            />
          </label>
        )}
        <label htmlFor="login-password" className="mb-4 block text-sm font-medium">
          {setupMode ? "Create password" : "Password"}
          <Input
            type="password"
            id="login-password"
            minLength={setupMode ? 15 : undefined}
            autoComplete={setupMode ? "new-password" : "current-password"}
            value={password}
            onChange={handlePasswordChange}
            className="mt-2"
          />
        </label>
        {setupMode && (
          <label htmlFor="login-confirmation" className="mb-4 block text-sm font-medium">
            Confirm password
            <Input
              type="password"
              id="login-confirmation"
              minLength={15}
              autoComplete="new-password"
              value={confirmation}
              onChange={handleConfirmationChange}
              className="mt-2"
            />
            </label>
        )}
        {setupMode && password !== confirmation && confirmation !== "" && (
          <p className="mb-4 text-sm text-destructive">Passwords do not match.</p>
        )}
        {error !== null && (
          <p className="mb-4 text-sm text-destructive">{error.message}</p>
        )}
        {oauthError !== undefined && (
          <p className="mb-4 text-sm text-destructive">{oauthError}</p>
        )}
        <button
          type="submit"
          disabled={pending || username === ""}
          className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {authenticationLabel(setupMode, pending)}
        </button>
        <button
          type="button"
          onClick={handleModeChange}
          className="mt-3 w-full py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {setupMode ? "Back to sign in" : "Activate a provisioned account"}
        </button>
        {!setupMode && aniListConfig.data?.enabled === true && (
          <>
            <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <a
              href="/api/auth/anilist/start"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-accent"
            >
              <Link2 className="size-4 text-primary" />
              Sign in with AniList
            </a>
          </>
        )}
      </form>
    </main>
  );
}
