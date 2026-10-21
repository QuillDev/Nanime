import { QRCodeSVG } from "qrcode.react";
import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { deviceLinkUrl, formatUserCode } from "../deviceLoginApi.ts";
import { useDeviceApproval, useTvSignIn } from "../hooks/useDeviceLogin.ts";
import { navigateToShows } from "../hooks/useMediaRoute.ts";
import { isTvApp } from "../lib/tvRemote.ts";
import type { AuthUser } from "../types.ts";
import { BrandLogo } from "./BrandLogo.tsx";
import { LoginScreen } from "./LoginScreen.tsx";
import { Input } from "./ui/input.tsx";

const PRIMARY_BUTTON = "w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const QUIET_BUTTON = "w-full rounded-md py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function TvCode(): React.JSX.Element {
  const { code } = useTvSignIn();
  if (code.data === undefined) {
    return (
      <div className="flex size-56 items-center justify-center rounded-2xl bg-secondary text-center text-sm text-muted-foreground">
        {code.isError ? "Couldn't get a sign-in code" : "Getting a code…"}
      </div>
    );
  }
  const url = deviceLinkUrl(code.data.userCode);
  return (
    <div className="flex items-center gap-10">
      <div className="shrink-0 rounded-2xl bg-white p-4">
        <QRCodeSVG value={url} size={192} level="M" title="Sign-in QR code" />
      </div>
      <div className="min-w-0">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">Sign in with your phone</h1>
        <p className="mt-3 max-w-md text-[15px] text-muted-foreground">Scan the code with your phone&apos;s camera, then confirm on your phone.</p>
        <p className="mt-6 text-sm text-muted-foreground">Or go to <span className="font-semibold text-foreground">{`${globalThis.location.host}/link`}</span> and enter</p>
        <p className="mt-1 font-mono text-4xl font-bold tracking-[0.12em] text-primary">{formatUserCode(code.data.userCode)}</p>
      </div>
    </div>
  );
}

/** The TV's sign-in page: a QR code a signed-in phone scans, and a password form as a fallback. */
function TvLoginScreen({ onPassword }: { readonly onPassword: () => void }): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-10 bg-background px-16 text-foreground">
      <BrandLogo className="h-9 w-auto self-start" />
      <TvCode />
      <button type="button" data-tv-primary onClick={onPassword} className="self-start rounded-full bg-white/12 px-5 py-2.5 text-sm font-semibold hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Use a password instead
      </button>
    </main>
  );
}

/** Signed out: the QR sign-in on Android TV, the password form everywhere else. */
export function SignInScreen({ tv = isTvApp() }: { readonly tv?: boolean }): React.JSX.Element {
  const [usePassword, setUsePassword] = useState(false);
  const handlePassword = useCallback(() => setUsePassword(true), []);
  const handlePhone = useCallback(() => setUsePassword(false), []);
  if (!tv) {
    return <LoginScreen />;
  }
  return usePassword ? <LoginScreen onUsePhone={handlePhone} /> : <TvLoginScreen onPassword={handlePassword} />;
}

function CodeForm(): React.JSX.Element {
  const [value, setValue] = useState("");
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = new URL(globalThis.location.href);
    url.searchParams.set("code", value.replaceAll(/[\s-]/gu, "").toUpperCase());
    globalThis.location.assign(url);
  }, [value]);
  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="device-code" className="mb-4 block text-sm font-medium">
        Code on your TV
        <Input id="device-code" value={value} onChange={handleChange} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-EFGH" className="mt-2 font-mono tracking-[0.12em]" />
      </label>
      <button type="submit" disabled={value.trim() === ""} className={PRIMARY_BUTTON}>Continue</button>
    </form>
  );
}

function Approval({ code, user }: { readonly code: string; readonly user: AuthUser }): React.JSX.Element {
  const { request, approve } = useDeviceApproval(code);
  const handleApprove = useCallback(() => approve.mutate(code), [approve, code]);
  if (approve.isSuccess) {
    return (
      <>
        <h1 className="font-display text-2xl font-extrabold">Your TV is signed in</h1>
        <p className="mt-2 text-sm text-muted-foreground">{`It's using your account, ${user.username}.`}</p>
        <button type="button" onClick={navigateToShows} className={`${PRIMARY_BUTTON} mt-8`}>Back to library</button>
      </>
    );
  }
  if (request.isError) {
    return (
      <>
        <p className="mb-6 text-sm text-destructive">This code has expired or was already used. Check the code on your TV.</p>
        <CodeForm />
      </>
    );
  }
  return (
    <>
      <h1 className="font-display text-2xl font-extrabold">Sign in your TV?</h1>
      <p className="mt-2 text-sm text-muted-foreground">{`${request.data?.device ?? "A device"} will use your account, ${user.username}. Check that this code matches your TV.`}</p>
      <p className="my-6 text-center font-mono text-3xl font-bold tracking-[0.12em] text-primary">{formatUserCode(code)}</p>
      {approve.error !== null && <p className="mb-4 text-sm text-destructive">{approve.error.message}</p>}
      <button type="button" onClick={handleApprove} disabled={request.data === undefined || approve.isPending} className={PRIMARY_BUTTON}>
        {approve.isPending ? "Signing in…" : "Sign in TV"}
      </button>
      <button type="button" onClick={navigateToShows} className={`${QUIET_BUTTON} mt-3`}>Cancel</button>
    </>
  );
}

/** `/link?code=…` on the phone: approve the TV whose QR code was scanned, or type its code. */
export function LinkDevicePage({ code, user }: { readonly code: string; readonly user: AuthUser }): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8">
        <BrandLogo className="mb-8 h-9 w-auto" />
        {code === "" ? <CodeForm /> : <Approval code={code} user={user} />}
      </div>
    </main>
  );
}
