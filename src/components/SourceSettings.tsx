import { useCallback, useState, type ChangeEvent, type ToggleEvent } from "react";
import { useSourceChange, useSourceSettings } from "../hooks/useSources.ts";
import { saveSourceSetting, type SourceSetting, type SourceSettingValue } from "../sourcesApi.ts";

interface SettingChange {
  readonly key: string;
  readonly value: SourceSettingValue;
}

const FIELD = "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function MultiOption({ setting, value, onSave }: {
  readonly setting: SourceSetting;
  readonly value: string;
  readonly onSave: (change: SettingChange) => void;
}): React.JSX.Element {
  const chosen = Array.isArray(setting.value) ? setting.value : [];
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const current = Array.isArray(setting.value) ? setting.value : [];
    const others = current.filter((entry) => entry !== value);
    onSave({ key: setting.key, value: event.target.checked ? [...others, value] : others });
  }, [onSave, setting.key, setting.value, value]);
  const label = setting.options.find((option) => option.value === value)?.label ?? value;
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="checkbox" checked={chosen.includes(value)} onChange={handleChange} className="size-3.5 accent-primary" />
      {label}
    </label>
  );
}

function TextSetting({ setting, onSave }: { readonly setting: SourceSetting; readonly onSave: (change: SettingChange) => void }): React.JSX.Element {
  const [text, setText] = useState(typeof setting.value === "string" ? setting.value : "");
  const handleText = useCallback((event: ChangeEvent<HTMLInputElement>) => setText(event.target.value), []);
  const handleBlur = useCallback(() => onSave({ key: setting.key, value: text }), [onSave, setting.key, text]);
  return <input value={text} onChange={handleText} onBlur={handleBlur} aria-label={setting.title} className={`${FIELD} w-48`} />;
}

function SettingInput({ setting, onSave }: { readonly setting: SourceSetting; readonly onSave: (change: SettingChange) => void }): React.JSX.Element {
  const handleSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => onSave({ key: setting.key, value: event.target.value }), [onSave, setting.key]);
  const handleToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => onSave({ key: setting.key, value: event.target.checked }), [onSave, setting.key]);
  if (setting.kind === "toggle") {
    return <input type="checkbox" checked={setting.value === true} onChange={handleToggle} aria-label={setting.title} className="size-4 accent-primary" />;
  }
  if (setting.kind === "multi") {
    return (
      <span className="flex max-w-72 flex-wrap justify-end gap-x-3 gap-y-1">
        {setting.options.map((option) => <MultiOption key={option.value} setting={setting} value={option.value} onSave={onSave} />)}
      </span>
    );
  }
  if (setting.kind === "text") {
    return <TextSetting setting={setting} onSave={onSave} />;
  }
  return (
    <select value={typeof setting.value === "string" ? setting.value : ""} onChange={handleSelect} aria-label={setting.title} className={`${FIELD} max-w-48`}>
      {setting.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

/** One installed source's own settings, as its plugin declares them. */
export function SourceSettings({ sourceId }: { readonly sourceId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const settings = useSourceSettings(sourceId, open);
  const save = useSourceChange(({ key, value }: SettingChange) => saveSourceSetting(sourceId, key, value));
  const handleToggle = useCallback((event: ToggleEvent<HTMLDetailsElement>) => setOpen(event.currentTarget.open), []);
  const handleSave = useCallback((change: SettingChange) => save.mutate(change), [save]);
  return (
    <details onToggle={handleToggle} className="mt-1">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Settings</summary>
      {settings.status === "error" && <p className="select-text pt-1 text-xs text-destructive">{settings.error.message}</p>}
      {settings.data?.length === 0 && <p className="pt-1 text-xs text-muted-foreground">This source has no settings.</p>}
      <ul className="pl-1">
        {settings.data?.map((setting) => (
          <li key={setting.key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 truncate">{setting.title}</span>
            <SettingInput setting={setting} onSave={handleSave} />
          </li>
        ))}
      </ul>
      {save.error !== null && <p className="select-text pt-1 text-xs text-destructive">{save.error.message}</p>}
    </details>
  );
}
