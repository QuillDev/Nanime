import { useCallback, useState } from "react";
import { Copy } from "lucide-react";
import { copyText } from "../lib/clipboard.ts";

interface CopyablePlaybackErrorProps {
  readonly detail: string;
}

export function CopyablePlaybackError({
  detail,
}: CopyablePlaybackErrorProps): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<"failed" | "idle" | "success">("idle");
  const handleCopy = useCallback(() => {
    void (async (): Promise<void> => {
      setCopyStatus(await copyText(detail) ? "success" : "failed");
    })();
  }, [detail]);
  return (
    <div
      role="alert"
      className="absolute left-4 top-4 z-40 max-w-[calc(100%-2rem)] rounded-md border border-destructive bg-black p-3 text-destructive"
    >
      <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words text-xs">
        {detail}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-3 inline-flex h-8 items-center gap-2 rounded-md bg-secondary px-3 text-xs font-semibold text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Copy className="size-3.5" />
        {copyStatus === "success" ? "Copied" : "Copy error"}
      </button>
      {copyStatus === "failed" && (
        <p className="mt-2 text-xs text-destructive">
          Clipboard access failed. Select the diagnostic text above to copy it manually.
        </p>
      )}
    </div>
  );
}
