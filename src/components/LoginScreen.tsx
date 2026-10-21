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

const OAUTH_ERRORS = new Map(Object.entries({
  "invalid-state": "The AniList sign-in response could not be verified. Please try again.",
  "expired-state": "The AniList sign-in request expired. Please try again.",
  "not-linked": "That AniList account is not linked to a provisioned Nanime user.",
  "already-linked": "That AniList account is already linked to another user.",
  failed: "AniList sign-in failed. Please try again.",
} as const));

function useTextField(): readonly [string, (event: ChangeEvent<HTMLInputElement>) => void] {
  const [value, setValue] = useState<string>("");
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  }, []);
  return [value, handleChange];
}

function useAuthenticationMutations() {
  return {
    login: useLogin(),
    setup: useSetupPassword(),
  };
}

function authenticationStatus(
  login: ReturnType<typeof useLogin>,
  setup: ReturnType<typeof useSetupPassword>,
) {
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

function useCredentialFields() {
  const username = useTextField();
  const password = useTextField();
  const confirmation = useTextField();
  const setupToken = useTextField();
  return { username, password, confirmation, setupToken };
}

function useLoginForm() {
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
  return result === null ? undefined : OAUTH_ERRORS.get(result);
}

interface CredentialInputsProps {
  readonly setupMode: boolean;
  readonly username: string;
  readonly password: string;
  readonly confirmation: string;
  readonly setupToken: string;
  readonly onUsernameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onConfirmationChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSetupTokenChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function CredentialInputs(props: CredentialInputsProps): React.JSX.Element {
  return (
    <>
      <label htmlFor="login-username" className="mb-4 block text-sm font-medium">
        Username
        <Input id="login-username" autoComplete="username" value={props.username} onChange={props.onUsernameChange} className="mt-2" />
      </label>
      {props.setupMode && (
        <label htmlFor="login-setup-token" className="mb-4 block text-sm font-medium">
          One-time setup code
          <Input type="password" id="login-setup-token" autoComplete="one-time-code" value={props.setupToken} onChange={props.onSetupTokenChange} className="mt-2" />
        </label>
      )}
      <label htmlFor="login-password" className="mb-4 block text-sm font-medium">
        {props.setupMode ? "Create password" : "Password"}
        <Input type="password" id="login-password" minLength={props.setupMode ? 15 : undefined} autoComplete={props.setupMode ? "new-password" : "current-password"} value={props.password} onChange={props.onPasswordChange} className="mt-2" />
      </label>
      {props.setupMode && (
        <label htmlFor="login-confirmation" className="mb-4 block text-sm font-medium">
          Confirm password
          <Input type="password" id="login-confirmation" minLength={15} autoComplete="new-password" value={props.confirmation} onChange={props.onConfirmationChange} className="mt-2" />
        </label>
      )}
    </>
  );
}

function AniListLoginOption({ enabled, setupMode }: {
  readonly enabled: boolean;
  readonly setupMode: boolean;
}): React.JSX.Element | null {
  if (setupMode || !enabled) {
    return null;
  }
  return (
    <>
      <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
      <a href="/api/auth/anilist/start" className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-accent">
        <Link2 className="size-4 text-primary" />
        Sign in with AniList
      </a>
    </>
  );
}

/** The Android app's link for this page: phones open a TV's QR code in the browser, where the app's session isn't. */
function appLink(): string | null {
  const agent = navigator.userAgent;
  const code = new URLSearchParams(globalThis.location.search).get("code");
  if (globalThis.location.pathname !== "/link" || !agent.includes("Android") || agent.includes("NanimeAndroid/") || code === null) {
    return null;
  }
  const fallback = encodeURIComponent(globalThis.location.href);
  return `intent://link?code=${encodeURIComponent(code)}#Intent;scheme=nanime;package=dev.nanime.android;S.browser_fallback_url=${fallback};end`;
}

function OpenInApp(): React.JSX.Element | null {
  const link = appLink();
  if (link === null) {
    return null;
  }
  return (
    <>
      <a href={link} className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground">Open in the Nanime app</a>
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or sign in here<span className="h-px flex-1 bg-border" /></div>
    </>
  );
}

function loginPrompt(setupMode: boolean): string {
  if (setupMode) {
    return "Activate your provisioned account";
  }
  return globalThis.location.pathname === "/link" ? "Sign in to connect your TV" : "Sign in to continue";
}

/** `onUsePhone` (on a TV) goes back to the QR sign-in. */
export function LoginScreen({ onUsePhone }: { readonly onUsePhone?: () => void }): React.JSX.Element {
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
            <p className="text-sm text-muted-foreground">{loginPrompt(setupMode)}</p>
          </div>
        </div>
        <OpenInApp />
        <CredentialInputs setupMode={setupMode} username={username} password={password} confirmation={confirmation} setupToken={setupToken} onUsernameChange={handleUsernameChange} onPasswordChange={handlePasswordChange} onConfirmationChange={handleConfirmationChange} onSetupTokenChange={handleSetupTokenChange} />
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
        <AniListLoginOption enabled={aniListConfig.data?.enabled === true} setupMode={setupMode} />
        {onUsePhone !== undefined && (
          <button type="button" onClick={onUsePhone} className="mt-3 w-full py-2 text-sm text-muted-foreground hover:text-foreground">
            Sign in with your phone instead
          </button>
        )}
      </form>
    </main>
  );
}
