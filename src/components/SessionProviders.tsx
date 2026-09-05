import type { ReactNode } from "react";
import { useWatchTogetherSession } from "../hooks/useWatchTogetherSession.ts";
import { WatchTogetherContext } from "../hooks/watchTogetherContext.ts";
import { SeriesCompletionProvider } from "./SeriesCompletionPrompt.tsx";
import { OfflineDownloadToast } from "./OfflineDownloadToast.tsx";

export function SessionProviders({ children, userId }: { readonly children: ReactNode; readonly userId: number }): React.JSX.Element {
  const session = useWatchTogetherSession(userId);
  return (
    <WatchTogetherContext value={session}>
      <SeriesCompletionProvider>
        {children}
        <OfflineDownloadToast />
      </SeriesCompletionProvider>
    </WatchTogetherContext>
  );
}
