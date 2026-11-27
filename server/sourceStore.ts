import { database, db, execute, queryOne, queryRows, type SourceRow, SourceRowSchema, SourceSettingRowSchema, sql } from "./database.ts";
import type { SettingValue } from "./sourceSettings.ts";
import { z } from "zod";

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

function installed(row: SourceRow): InstalledSource {
  return {
    id: row.id, repoUrl: row.repo_url, name: row.name, lang: row.lang, version: row.version,
    iconUrl: row.icon_url, nsfw: row.nsfw === 1, info: JSON.parse(row.info) as SourceInfo, code: row.code,
  };
}

const SettingSchema = SourceSettingRowSchema.pick({ key: true, value: true });
const UrlSchema = z.object({ url: z.string() });

export function sourceRepos(): readonly string[] {
  return queryRows(sql`SELECT url FROM source_repos ORDER BY added_at, rowid`, UrlSchema).map((row) => row.url);
}

export function addSourceRepo(url: string): void {
  execute(db.insertInto("source_repos").orIgnore().values({ url, added_at: Date.now() }));
}

export function removeSourceRepo(url: string): void {
  execute(db.deleteFrom("source_repos").where("url", "=", url));
}

export function installedSources(): readonly InstalledSource[] {
  return queryRows(sql`SELECT * FROM sources ORDER BY name COLLATE NOCASE, id`, SourceRowSchema).map((row) => installed(row));
}

export function installedSource(id: string): InstalledSource | null {
  const row = queryOne(db.selectFrom("sources").selectAll().where("id", "=", id), SourceRowSchema);
  return row === null ? null : installed(row);
}

export function saveSource(source: InstalledSource): void {
  const fields = {
    name: source.name, lang: source.lang, version: source.version, icon_url: source.iconUrl,
    nsfw: source.nsfw ? 1 : 0, info: JSON.stringify(source.info), code: source.code,
  };
  execute(db.insertInto("sources").values({ id: source.id, repo_url: source.repoUrl, ...fields, installed_at: Date.now() })
    .onConflict((conflict) => conflict.column("id").doUpdateSet(fields)));
}

export function uninstallSource(id: string): void {
  database.transaction(() => {
    execute(db.deleteFrom("sources").where("id", "=", id));
    execute(db.deleteFrom("source_settings").where("source_id", "=", id));
  })();
}

/** Settings the admin changed, as JSON values by key; defaults come from the plugin itself. */
export function sourceSettings(id: string): ReadonlyMap<string, SettingValue> {
  return new Map(queryRows(db.selectFrom("source_settings").select(["key", "value"]).where("source_id", "=", id), SettingSchema).map((row) => [row.key, JSON.parse(row.value) as SettingValue]));
}

export function saveSourceSetting(id: string, key: string, value: SettingValue): void {
  const stored = JSON.stringify(value);
  execute(db.insertInto("source_settings").values({ source_id: id, key, value: stored })
    .onConflict((conflict) => conflict.columns(["source_id", "key"]).doUpdateSet({ value: stored })));
}
