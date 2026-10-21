import { useCallback, type ChangeEvent } from "react";
import {
  setPlaybackDiagnosticsEnabled,
  usePlaybackDiagnosticsEnabled,
} from "../lib/playbackDiagnosticsPreference.ts";
import { setStreamChoiceEnabled, useStreamChoiceEnabled } from "../lib/streamChoicePreference.ts";
import { usePlaybackPreferences } from "../hooks/useAuth.ts";
import type { AuthUser, PreferredAudioLanguage } from "../types.ts";
import { ProfileSection, ProfileSetting, ProfileSwitch } from "./ProfileSection.tsx";

const AUDIO_OPTIONS = [
  { value: "", label: "Auto", summary: "Auto audio" },
  { value: "ja", label: "Japanese", summary: "Japanese audio" },
  { value: "en", label: "English", summary: "English audio" },
] as const;

function AudioLanguagePicker({ value, disabled, onSelect }: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  return (
    <fieldset aria-label="Default audio language" disabled={disabled} className="inline-flex rounded-lg bg-secondary p-0.5 disabled:opacity-60">
      {AUDIO_OPTIONS.map((option) => (
        <label key={option.value} className="cursor-pointer">
          <input
            type="radio"
            name="audio-language"
            value={option.value}
            checked={value === option.value}
            onChange={onSelect}
            className="peer sr-only"
          />
          <span className="block rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground peer-checked:bg-accent peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            {option.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function PlaybackPreferences({ user }: { readonly user: AuthUser }): React.JSX.Element {
  const diagnosticsEnabled = usePlaybackDiagnosticsEnabled();
  const preferences = usePlaybackPreferences();
  const handleDiagnosticsToggle = useCallback(() => {
    setPlaybackDiagnosticsEnabled(!diagnosticsEnabled);
  }, [diagnosticsEnabled]);
  const streamChoice = useStreamChoiceEnabled();
  const handleStreamChoice = useCallback(() => {
    setStreamChoiceEnabled(!streamChoice);
  }, [streamChoice]);
  const handleAudioLanguage = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    preferences.mutate(value === "" ? null : value as PreferredAudioLanguage);
  }, [preferences]);
  const language = (preferences.isPending ? preferences.variables : user.preferredAudioLanguage) ?? "";
  const summary = AUDIO_OPTIONS.find((option) => option.value === language)?.summary;
  return (
    <ProfileSection id="playback-preferences" title="Playback" summary={summary}>
      <ProfileSetting label="Audio language">
        <AudioLanguagePicker value={language} disabled={preferences.isPending} onSelect={handleAudioLanguage} />
      </ProfileSetting>
      <ProfileSetting label="Player diagnostics">
        <ProfileSwitch checked={diagnosticsEnabled} label="Playback diagnostics" onToggle={handleDiagnosticsToggle} />
      </ProfileSetting>
      {/* Off by default: shows the player's Original/Converted choice and its timeline strip. */}
      <ProfileSetting label="Original or converted stream in the player">
        <ProfileSwitch checked={streamChoice} label="Stream choice in the player" onToggle={handleStreamChoice} />
      </ProfileSetting>
      {preferences.isError && (
        <p className="select-text pt-2 text-sm text-destructive">{preferences.error.message}</p>
      )}
    </ProfileSection>
  );
}
