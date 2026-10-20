/**
 * A plugin's settings as it declares them in `getSourcePreferences()`, in
 * Mangayomi's shape. The value a plugin reads is the admin's saved choice, or
 * else the default its declaration carries.
 */
export interface SourcePreference {
  readonly key: string;
  readonly listPreference?: {
    readonly title?: string;
    readonly summary?: string;
    readonly valueIndex?: number;
    readonly entries?: readonly string[];
    readonly entryValues?: readonly string[];
  };
  readonly multiSelectListPreference?: {
    readonly title?: string;
    readonly summary?: string;
    readonly entries?: readonly string[];
    readonly entryValues?: readonly string[];
    readonly values?: readonly string[];
  };
  readonly switchPreferenceCompat?: { readonly title?: string; readonly summary?: string; readonly value?: boolean };
  readonly checkBoxPreference?: { readonly title?: string; readonly summary?: string; readonly value?: boolean };
  readonly editTextPreference?: { readonly title?: string; readonly summary?: string; readonly value?: string };
}

/** A setting's value: a list choice or text, a toggle, or a multi-select's choices. */
export type SettingValue = string | boolean | readonly string[] | null;

/** The declared default for one setting, as `SharedPreferences.get` returns it. */
export function defaultValue(preference: SourcePreference): SettingValue {
  const list = preference.listPreference;
  if (list !== undefined) {
    return list.entryValues?.[list.valueIndex ?? 0] ?? null;
  }
  const toggle = preference.switchPreferenceCompat ?? preference.checkBoxPreference;
  if (toggle !== undefined) {
    return toggle.value ?? false;
  }
  if (preference.editTextPreference !== undefined) {
    return preference.editTextPreference.value ?? "";
  }
  return preference.multiSelectListPreference?.values ?? [];
}

/** The value a plugin reads for `key`: the saved choice, else its declared default; null when undeclared. */
export function settingValue(preferences: readonly SourcePreference[], stored: ReadonlyMap<string, SettingValue>, key: string): SettingValue {
  const saved = stored.get(key);
  if (saved !== undefined) {
    return saved;
  }
  const declared = preferences.find((preference) => preference.key === key);
  return declared === undefined ? null : defaultValue(declared);
}

/** Whether `value` fits the setting it would replace (an offered option, a boolean, text, or options). */
export function validSetting(preference: SourcePreference, value: unknown): value is SettingValue {
  if (preference.listPreference !== undefined) {
    return typeof value === "string" && (preference.listPreference.entryValues ?? []).includes(value);
  }
  if (preference.switchPreferenceCompat !== undefined || preference.checkBoxPreference !== undefined) {
    return typeof value === "boolean";
  }
  if (preference.editTextPreference !== undefined) {
    return typeof value === "string" && value.length <= 2000;
  }
  const options = new Set(preference.multiSelectListPreference?.entryValues);
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && options.has(entry));
}
