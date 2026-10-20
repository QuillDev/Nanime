import { jsonObject, type JsonObject, type JsonValue } from "./json.ts";
import { assertPublicUrl } from "./sourceHttp.ts";
import { runSource } from "./sourceRuntime.ts";
import { addSourceRepo, installedSources, saveSource, sourceRepos, type InstalledSource, type SourceInfo } from "./sourceStore.ts";

/**
 * Mangayomi-style repositories: an index JSON listing sources, each with its
 * metadata and a link to its code. Nanime offers the anime sources written in
 * JavaScript (Dart sources need Mangayomi's own interpreter).
 */
const FETCH_TIMEOUT_MS = 20_000;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_CODE_BYTES = 4 * 1024 * 1024;
const INDEX_CACHE_MS = 10 * 60 * 1000;
const ANIME_ITEM_TYPE = 1;
const JAVASCRIPT = 1;

interface AvailableSource {
  /** `<repo url>#<index id>`. */
  readonly id: string;
  readonly repoUrl: string;
  readonly name: string;
  readonly lang: string;
  readonly version: string;
  readonly iconUrl: string | null;
  readonly nsfw: boolean;
  /** Installed version, or null when not installed. */
  readonly installedVersion: string | null;
}

interface IndexedSource extends Omit<AvailableSource, "installedVersion"> {
  installedVersion: string | null;
  readonly codeUrl: string;
  readonly info: SourceInfo;
}

export class SourceRepoError extends Error {
  override name = "SourceRepoError";
}

const indexes = new Map<string, { readonly at: number; readonly sources: readonly IndexedSource[] }>();

async function fetchText(url: string, limit: number, what: string): Promise<string> {
  const target = URL.parse(url);
  if (target === null) {
    throw new SourceRepoError(`${what} isn't a valid link`);
  }
  await assertPublicUrl(target);
  const response = await fetch(target, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
  if (response?.ok !== true) {
    throw new SourceRepoError(`Couldn't download ${what} (${response === null ? "unreachable" : String(response.status)})`);
  }
  const bytes = await response.bytes();
  if (bytes.byteLength > limit) {
    throw new SourceRepoError(`${what} is too large`);
  }
  return new TextDecoder().decode(bytes);
}

const string = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

function isAnimeJs(entry: JsonObject): boolean {
  const anime = entry["itemType"] === ANIME_ITEM_TYPE || (entry["itemType"] === undefined && entry["isManga"] === false);
  return anime && entry["sourceCodeLanguage"] === JAVASCRIPT && typeof entry["sourceCodeUrl"] === "string";
}

function info(entry: JsonObject): SourceInfo {
  return {
    id: typeof entry["id"] === "number" ? entry["id"] : 0,
    name: string(entry["name"]),
    baseUrl: string(entry["baseUrl"]),
    apiUrl: string(entry["apiUrl"]),
    lang: string(entry["lang"]),
    isFullData: entry["isFullData"] === true,
    hasCloudflare: entry["hasCloudflare"] === true,
    dateFormat: string(entry["dateFormat"]),
    dateFormatLocale: string(entry["dateFormatLocale"]),
    additionalParams: string(entry["additionalParams"]),
    notes: string(entry["notes"]),
  };
}

function indexedSource(repoUrl: string, entry: JsonObject, installed: ReadonlyMap<string, InstalledSource>): IndexedSource {
  const id = `${repoUrl}#${String(entry["id"] ?? entry["name"])}`;
  return {
    id, repoUrl,
    name: string(entry["name"], "Unnamed source"),
    lang: string(entry["lang"]),
    version: string(entry["version"], "0"),
    iconUrl: typeof entry["iconUrl"] === "string" && entry["iconUrl"] !== "" ? entry["iconUrl"] : null,
    nsfw: entry["isNsfw"] === true,
    installedVersion: installed.get(id)?.version ?? null,
    codeUrl: new URL(string(entry["sourceCodeUrl"]), repoUrl).href,
    info: info(entry),
  };
}

function parseJson(body: string): JsonValue {
  try {
    return JSON.parse(body) as JsonValue;
  } catch {
    return null;
  }
}

async function readIndex(repoUrl: string, fresh: boolean): Promise<readonly IndexedSource[]> {
  const cached = indexes.get(repoUrl);
  const installed = new Map(installedSources().map((source) => [source.id, source]));
  if (!fresh && cached !== undefined && Date.now() - cached.at < INDEX_CACHE_MS) {
    for (const source of cached.sources) {
      source.installedVersion = installed.get(source.id)?.version ?? null;
    }
    return cached.sources;
  }
  const body = await fetchText(repoUrl, MAX_INDEX_BYTES, "the repository index");
  const parsed = parseJson(body);
  if (!Array.isArray(parsed)) {
    throw new SourceRepoError("That link isn't a Mangayomi repository index (a JSON list of sources)");
  }
  const entries = parsed.flatMap((value) => {
    const entry = jsonObject(value);
    return entry !== null && isAnimeJs(entry) ? [indexedSource(repoUrl, entry, installed)] : [];
  });
  indexes.set(repoUrl, { at: Date.now(), sources: entries });
  return entries;
}

/** Checks the link is a readable index before remembering it. */
export async function addRepo(url: string): Promise<number> {
  const sources = await readIndex(url, true);
  addSourceRepo(url);
  return sources.length;
}

interface RepoListing {
  readonly url: string;
  readonly sources: readonly AvailableSource[];
  readonly error: string | null;
}

function available(source: IndexedSource): AvailableSource {
  const { codeUrl: _codeUrl, info: _info, ...rest } = source;
  return rest;
}

/** Every added repository with the anime sources it offers; an unreachable one reports why. */
export async function listRepos(fresh: boolean): Promise<readonly RepoListing[]> {
  return await Promise.all(sourceRepos().map(async (url) => {
    try {
      const sources = await readIndex(url, fresh);
      return { url, sources: sources.map((source) => available(source)), error: null };
    } catch (error) {
      return { url, sources: [], error: error instanceof Error ? error.message : "Couldn't read this repository" };
    }
  }));
}

/** Downloads a source's code, proves it loads, and installs (or updates) it. */
export async function installSource(id: string): Promise<InstalledSource> {
  const repoUrl = id.slice(0, Math.max(0, id.lastIndexOf("#")));
  if (!sourceRepos().includes(repoUrl)) {
    throw new SourceRepoError("Add the source's repository first");
  }
  const offered = await readIndex(repoUrl, true);
  const entry = offered.find((source) => source.id === id);
  if (entry === undefined) {
    throw new SourceRepoError("That repository no longer offers this source");
  }
  const code = await fetchText(entry.codeUrl, MAX_CODE_BYTES, `${entry.name}'s code`);
  const source: InstalledSource = {
    id, repoUrl, name: entry.name, lang: entry.lang, version: entry.version, iconUrl: entry.iconUrl, nsfw: entry.nsfw, info: entry.info, code,
  };
  await runSource(source, "extention.getSourcePreferences()", "loading");
  saveSource(source);
  return source;
}
