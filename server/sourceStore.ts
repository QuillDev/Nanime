import { database } from "./database.ts";
import type { SettingValue } from "./sourceSettings.ts";

/**
 * Source plugins: the repositories an admin added (Mangayomi-style index
 * URLs), the sources installed from them with their code, and each source's
 * settings as the admin changed them.
 */
database.run(`
  CREATE TABLE IF NOT EXISTS source_repos (
    url TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    repo_url TEXT NOT NULL,
    name TEXT NOT NULL,
    lang TEXT NOT NULL,
    version TEXT NOT NULL,
    icon_url TEXT,
    nsfw INTEGER NOT NULL,
    info TEXT NOT NULL,
    code TEXT NOT NULL,
    installed_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS source_settings (
    source_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (source_id, key)
  )
`);

/** What `this.source` reads inside the plugin (Mangayomi's MSource fields). */
export interface SourceInfo {
  readonly id: number;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiUrl: string;
  readonly lang: string;
  readonly isFullData: boolean;
  readonly hasCloudflare: boolean;
  readonly dateFormat: string;
  readonly dateFormatLocale: string;
  readonly additionalParams: string;
  readonly notes: string;
}

export interface InstalledSource {
  /** `<repo url>#<index id>`, unique across repositories. */
  readonly id: string;
  readonly repoUrl: string;
  readonly name: string;
  readonly lang: string;
  readonly version: string;
  readonly iconUrl: string | null;
  readonly nsfw: boolean;
  readonly info: SourceInfo;
  readonly code: string;
}

interface SourceRow {
  readonly id: string;
  readonly repo_url: string;
  readonly name: string;
  readonly lang: string;
  readonly version: string;
  readonly icon_url: string | null;
  readonly nsfw: number;
  readonly info: string;
  readonly code: string;
}

function installed(row: SourceRow): InstalledSource {
  return {
    id: row.id, repoUrl: row.repo_url, name: row.name, lang: row.lang, version: row.version,
    iconUrl: row.icon_url, nsfw: row.nsfw === 1, info: JSON.parse(row.info) as SourceInfo, code: row.code,
  };
}

const repoRows = database.query<{ readonly url: string }, []>("SELECT url FROM source_repos ORDER BY added_at, rowid");
const insertRepo = database.query<unknown, [string, number]>("INSERT OR IGNORE INTO source_repos (url, added_at) VALUES (?, ?)");
const deleteRepo = database.query<unknown, [string]>("DELETE FROM source_repos WHERE url = ?");
const sourceRows = database.query<SourceRow, []>("SELECT * FROM sources ORDER BY name COLLATE NOCASE, id");
const sourceRow = database.query<SourceRow, [string]>("SELECT * FROM sources WHERE id = ?");
const upsertSource = database.query<unknown, [string, string, string, string, string, string | null, number, string, string, number]>(`
  INSERT INTO sources (id, repo_url, name, lang, version, icon_url, nsfw, info, code, installed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, lang = excluded.lang, version = excluded.version,
    icon_url = excluded.icon_url, nsfw = excluded.nsfw, info = excluded.info, code = excluded.code
`);
const deleteSource = database.query<unknown, [string]>("DELETE FROM sources WHERE id = ?");
const settingRows = database.query<{ readonly key: string; readonly value: string }, [string]>("SELECT key, value FROM source_settings WHERE source_id = ?");
const upsertSetting = database.query<unknown, [string, string, string]>(`
  INSERT INTO source_settings (source_id, key, value) VALUES (?, ?, ?)
  ON CONFLICT (source_id, key) DO UPDATE SET value = excluded.value
`);
const deleteSettings = database.query<unknown, [string]>("DELETE FROM source_settings WHERE source_id = ?");

export function sourceRepos(): readonly string[] {
  return repoRows.all().map((row) => row.url);
}

export function addSourceRepo(url: string): void {
  insertRepo.run(url, Date.now());
}

export function removeSourceRepo(url: string): void {
  deleteRepo.run(url);
}

export function installedSources(): readonly InstalledSource[] {
  return sourceRows.all().map((row) => installed(row));
}

export function installedSource(id: string): InstalledSource | null {
  const row = sourceRow.get(id);
  return row === null ? null : installed(row);
}

export function saveSource(source: InstalledSource): void {
  upsertSource.run(
    source.id, source.repoUrl, source.name, source.lang, source.version, source.iconUrl,
    source.nsfw ? 1 : 0, JSON.stringify(source.info), source.code, Date.now(),
  );
}

export function uninstallSource(id: string): void {
  database.transaction(() => {
    deleteSource.run(id);
    deleteSettings.run(id);
  })();
}

/** Settings the admin changed, as JSON values by key; defaults come from the plugin itself. */
export function sourceSettings(id: string): ReadonlyMap<string, SettingValue> {
  return new Map(settingRows.all(id).map((row) => [row.key, JSON.parse(row.value) as SettingValue]));
}

export function saveSourceSetting(id: string, key: string, value: SettingValue): void {
  upsertSetting.run(id, key, JSON.stringify(value));
}
