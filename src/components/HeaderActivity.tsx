import { NotificationBell } from "./NotificationBell.tsx";
import { PartyMenu } from "./PartyMenu.tsx";

/** Icon-only header actions before the account avatar: the admin bell and watch party. */
export function HeaderActivity({ isAdmin }: { readonly isAdmin: boolean }): React.JSX.Element {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {isAdmin && <NotificationBell />}
      <PartyMenu />
    </div>
  );
}
