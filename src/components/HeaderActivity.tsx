import { NotificationBell } from "./NotificationBell.tsx";
import { PartyMenu } from "./PartyMenu.tsx";

/** Icon-only header actions left of the tabs: the admin bell and watch party. Stays in the top bar on touch screens. */
export function HeaderActivity({ isAdmin }: { readonly isAdmin: boolean }): React.JSX.Element {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 sm:mr-2">
      {isAdmin && <NotificationBell />}
      <PartyMenu />
    </div>
  );
}
