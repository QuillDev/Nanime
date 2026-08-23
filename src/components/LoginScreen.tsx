import {
  useCallback,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Input } from "./ui/input.tsx";
import { useLogin, useSetupPassword } from "../hooks/useAuth.ts";
import { BrandLogo } from "./BrandLogo.tsx";

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

export function LoginScreen(): React.JSX.Element {
  const [username, handleUsernameChange] = useTextField();
  const [password, handlePasswordChange] = useTextField();
  const [confirmation, handleConfirmationChange] = useTextField();
  const [setupToken, handleSetupTokenChange] = useTextField();
  const [setupMode, setSetupMode] = useState<boolean>(false);
  const { login, setup } = useAuthenticationMutations();
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupMode) {
      if (password === confirmation) {
        setup.mutate({ username, password, setupToken });
      }
    } else {
      login.mutate({ username, password });
    }
  }, [confirmation, login, password, setup, setupMode, setupToken, username]);
  const handleModeChange = useCallback(() => setSetupMode((current) => !current), []);
  const { error, pending } = authenticationStatus(login, setup);

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
      </form>
    </main>
  );
}
