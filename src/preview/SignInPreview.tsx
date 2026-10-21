import { LinkDevicePage, SignInScreen } from "../components/DeviceSignIn.tsx";
import { previewUser } from "./fixtures.ts";
import { PREVIEW_DEVICE_CODE } from "./signInFixtures.ts";

/** `login-tv` (the TV's QR sign-in), `link` (the phone's approval) and `link-code` (no code yet). */
export function SignInPreview({ state }: { readonly state: string }): React.JSX.Element {
  if (state === "login-tv") {
    return <SignInScreen tv />;
  }
  return <LinkDevicePage code={state === "link" ? PREVIEW_DEVICE_CODE : ""} user={previewUser} />;
}
