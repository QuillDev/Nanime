import { createContext, use } from "react";
import type { useWatchTogetherSession } from "./useWatchTogetherSession.ts";

export const WatchTogetherContext = createContext<ReturnType<typeof useWatchTogetherSession> | null>(null);

export function useWatchTogetherContext() {
  const session = use(WatchTogetherContext);
  if (session === null) { throw new Error("Watch together requires an authenticated session."); }
  return session;
}
