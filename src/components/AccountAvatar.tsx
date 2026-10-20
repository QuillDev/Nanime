import { useAniListAccount } from "../hooks/useAniListAccount.ts";

/** The connected AniList avatar, else the username's initial on pink. */
export function AccountAvatar({ username }: { readonly username: string }): React.JSX.Element {
  const avatarUrl = useAniListAccount().data?.account?.avatarUrl ?? null;
  if (avatarUrl !== null) {
    return <img src={avatarUrl} alt="" className="size-8 rounded-full object-cover" />;
  }
  return (
    <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-primary font-display text-sm font-extrabold text-primary-foreground">
      {username.trim().slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}
