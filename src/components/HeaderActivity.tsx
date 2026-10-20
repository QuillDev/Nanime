import { NotificationBell } from "./NotificationBell.tsx";
import { PartyMenu } from "./PartyMenu.tsx";

/** Live activity controls in the header: watch parties and the admin notification bell. */
export function HeaderActivity({ isAdmin }: { readonly isAdmin: boolean }): React.JSX.Element {
  return (
    <>
      <PartyMenu />
      {isAdmin && <NotificationBell />}
    </>
  );
}
