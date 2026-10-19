import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTranscodes } from "../api.ts";
import { navigateToAdminTab } from "../hooks/useMediaRoute.ts";

const ACTIVITY_POLL_MS = 10_000;

/** Admin-only nav indicator while stored transcodes run; opens the transcodes page. */
export function TranscodeActivity(): React.JSX.Element | null {
  const jobs = useQuery({
    queryKey: ["transcodes"],
    queryFn: ({ signal }) => fetchTranscodes(signal),
    refetchInterval: ACTIVITY_POLL_MS,
  });
  const handleOpen = useCallback(() => {
    navigateToAdminTab("transcodes");
  }, []);
  const running = (jobs.data ?? []).filter((job) => job.status === "processing").length;
  const queued = (jobs.data ?? []).filter((job) => job.status === "queued").length;
  if (running === 0 && queued === 0) {
    return null;
  }
  const label = running === 0 ? `${String(queued)} queued` : `Transcoding ${String(running)}`;
  return (
    <button
      type="button"
      onClick={handleOpen}
      title={`${String(running)} transcoding, ${String(queued)} queued`}
      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-primary/15 px-3 text-[13px] font-medium tabular-nums hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{running + queued}</span>
    </button>
  );
}
