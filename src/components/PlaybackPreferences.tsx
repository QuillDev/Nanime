import { useCallback, type ChangeEvent } from "react";
import { PlayCircle } from "lucide-react";
import {
  setPlaybackDiagnosticsEnabled,
  usePlaybackDiagnosticsEnabled,
} from "../lib/playbackDiagnosticsPreference.ts";
import { usePlaybackPreferences } from "../hooks/useAuth.ts";
import type { AuthUser, PreferredAudioLanguage } from "../types.ts";
import { ProfileSection, ProfileSetting } from "./ProfileSection.tsx";

export function PlaybackPreferences({
  className,
  user,
}: {
  readonly className?: string;
  readonly user: AuthUser;
}): React.JSX.Element {
  const diagnosticsEnabled = usePlaybackDiagnosticsEnabled();
  const preferences = usePlaybackPreferences();
  const handleDiagnosticsToggle = useCallback(() => {
    setPlaybackDiagnosticsEnabled(!diagnosticsEnabled);
  }, [diagnosticsEnabled]);
  const handleAudioLanguage = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    preferences.mutate(value === "" ? null : value as PreferredAudioLanguage);
  }, [preferences]);
  return (
    <ProfileSection
      className={className}
      description="Defaults used when an episode starts."
      icon={PlayCircle}
      id="playback-preferences-title"
      title="Playback"
    >
      <div className="divide-y divide-border">
        <ProfileSetting
          label="Audio language"
          description="Falls back to the file's default when unavailable."
        >
        <select
          aria-label="Default audio language"
          value={(preferences.isPending
            ? preferences.variables
            : user.preferredAudioLanguage) ?? ""}
          disabled={preferences.isPending}
          onChange={handleAudioLanguage}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-40"
        >
          <option value="">Media default</option>
          <option value="ja">Japanese</option>
          <option value="en">English</option>
        </select>
        </ProfileSetting>
        <ProfileSetting
          label="Diagnostics"
          description="Show troubleshooting tools in the player."
        >
        <button
          type="button"
          role="switch"
          aria-checked={diagnosticsEnabled}
          aria-label="Playback diagnostics"
          onClick={handleDiagnosticsToggle}
          className="group relative ml-auto block h-7 w-12 shrink-0 rounded-full bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-primary sm:ml-0"
        >
          <span className="absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform group-aria-checked:translate-x-5" />
          <span className="sr-only">{diagnosticsEnabled ? "Disable" : "Enable"} playback diagnostics</span>
        </button>
        </ProfileSetting>
      </div>
      {preferences.isError && (
        <p className="select-text border-t border-border px-4 py-3 text-sm text-destructive sm:px-5">{preferences.error.message}</p>
      )}
    </ProfileSection>
  );
}
