import type { ChangeEvent } from "react";
import { Film, Search } from "lucide-react";
import type { AuthUser } from "../types.ts";
import { Input } from "./ui/input.tsx";
import { UserMenu } from "./UserMenu.tsx";

interface MediaHeaderProps {
  readonly user: AuthUser;
  readonly query: string;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly showFolders: readonly string[];
}

export function MediaHeader({
  user,
  query,
  onQueryChange,
  showFolders,
}: MediaHeaderProps): React.JSX.Element {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-6 py-4">
      <Film className="size-6 text-primary" />
      <h1 className="text-lg font-semibold tracking-tight">Nanime</h1>
      <div className="relative ml-auto w-full max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search…"
          value={query}
          onChange={onQueryChange}
          aria-label="Search library"
          className="pl-9"
        />
      </div>
      <UserMenu user={user} showFolders={showFolders} />
    </header>
  );
}
