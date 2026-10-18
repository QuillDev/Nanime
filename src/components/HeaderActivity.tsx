import { PartyMenu } from "./PartyMenu.tsx";
import { TranscodeActivity } from "./TranscodeActivity.tsx";

/** Live activity controls in the header: transcodes (admins) and watch parties. */
export function HeaderActivity({ isAdmin }: { readonly isAdmin: boolean }): React.JSX.Element {
  return (
    <>
      {isAdmin && <TranscodeActivity />}
      <PartyMenu />
    </>
  );
}
