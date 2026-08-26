import { useCallback } from "react";
import { Activity } from "lucide-react";
import {
  setPlaybackDiagnosticsEnabled,
  usePlaybackDiagnosticsEnabled,
} from "../lib/playbackDiagnosticsPreference.ts";

export function PlaybackPreferences(): React.JSX.Element {
  const diagnosticsEnabled = usePlaybackDiagnosticsEnabled();
  const handleDiagnosticsToggle = useCallback(() => {
    setPlaybackDiagnosticsEnabled(!diagnosticsEnabled);
  }, [diagnosticsEnabled]);
  return (
    <section className="border-b border-border py-6" aria-labelledby="playback-preferences-title">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="size-5 text-primary" />
        <h2 id="playback-preferences-title" className="text-lg font-semibold">Playback</h2>
      </div>
      <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-card p-4">
        <div>
          <p className="font-medium">Playback diagnostics</p>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Collect a rolling two-minute player timeline and show the copy diagnostics button.
            Enable this only while troubleshooting; reports are never sent automatically.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={diagnosticsEnabled}
          aria-label="Playback diagnostics"
          onClick={handleDiagnosticsToggle}
          className="group relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-primary"
        >
          <span className="absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform group-aria-checked:translate-x-5" />
          <span className="sr-only">{diagnosticsEnabled ? "Disable" : "Enable"} playback diagnostics</span>
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">This preference is stored on this device.</p>
    </section>
  );
}
