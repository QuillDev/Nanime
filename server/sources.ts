import { LibraryFileError } from "./libraryPaths.ts";
import { enqueueSourceEpisodes } from "./fileDownloads.ts";
import { jsonObject, type JsonObject } from "./json.ts";
import { SourceRepoError, addRepo, installSource, listRepos } from "./sourceRepos.ts";
import { SourceRequestError } from "./sourceHttp.ts";
import { SourceError, runSource, sourcePreferences } from "./sourceRuntime.ts";
import { settingValue, validSetting, type SettingValue, type SourcePreference } from "./sourceSettings.ts";
import { installedSource, installedSources, removeSourceRepo, saveSourceSetting, sourceSettings, uninstallSource, type InstalledSource } from "./sourceStore.ts";

/**
 * `/api/sources`: Mangayomi-compatible source plugins. Admins add repositories,
 * install sources from them, change their settings, search them, list a
 * show's episodes and queue episodes as downloads into a show folder.
 */
const MAX_EPISODES = 500;

interface Body {
  readonly url?: unknown;
  readonly id?: unknown;
  readonly key?: unknown;
  readonly value?: unknown;
  readonly showFolder?: unknown;
  readonly episodes?: unknown;
}

function bad(message: string, status = 400): Response {
  return new Response(message, { status });
}

interface SourceView {
  readonly id: string;
  readonly repoUrl: string;
  readonly name: string;
  readonly lang: string;
  readonly version: string;
  readonly iconUrl: string | null;
  readonly nsfw: boolean;
}

function sourceView({ id, repoUrl, name, lang, version, iconUrl, nsfw }: InstalledSource): SourceView {
  return { id, repoUrl, name, lang, version, iconUrl, nsfw };
}

function sourceById(id: unknown): InstalledSource {
  const found = typeof id === "string" ? installedSource(id) : null;
  if (found === null) {
    throw new SourceRepoError("That source isn't installed");
  }
  return found;
}

const string = (value: unknown): string => (typeof value === "string" ? value : "");

interface ResultView {
  readonly name: string;
  readonly imageUrl: string | null;
  /** The source's one-line summary (a torrent's size and seeders), cut to a line. */
  readonly description: string | null;
  readonly link: string;
}

const MAX_DESCRIPTION = 200;

/** One search result as the find page shows it. */
function result(value: unknown): readonly ResultView[] {
  const item = jsonObject(value);
  const link = string(item?.["link"]);
  const description = string(item?.["description"]).replaceAll(/\s+/gu, " ").trim().slice(0, MAX_DESCRIPTION);
  return item === null || link === "" ? [] : [{ name: string(item["name"]) || link, imageUrl: string(item["imageUrl"]) || null, description: description || null, link }];
}

async function searchResponse(url: URL): Promise<Response> {
  const query = url.searchParams.get("q")?.trim() ?? "";
  const page = Number(url.searchParams.get("page") ?? "1");
  if (query === "" || query.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 1000) {
    return bad("Search needs a title and a page number");
  }
  const chosen = sourceById(url.searchParams.get("id"));
  const answer = await runSource(chosen, `extention.search(${JSON.stringify(query)}, ${String(page)}, __filters())`, "searching");
  const found = jsonObject(answer);
  const list = Array.isArray(found?.["list"]) ? found["list"] : [];
  return Response.json({ results: list.flatMap((item) => result(item)), hasNextPage: found?.["hasNextPage"] === true });
}

/** The episode number a name states ("Episode 12", "Ep. 12.5", "12"), or null. */
function statedEpisodeNumber(name: string): number | null {
  const match = /(?:episode|ep\.?|e)\s*(?<number>\d+(?:\.\d+)?)/iu.exec(name) ?? /^\s*(?<number>\d+(?:\.\d+)?)\b/u.exec(name);
  const stated = match?.groups?.["number"];
  const number = stated === undefined ? Number.NaN : Number(stated);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

interface Episode {
  readonly name: string;
  readonly url: string;
  readonly number: number;
}

/** Episodes oldest first, numbered by their names, or by position when names don't say. */
function numberedEpisodes(values: readonly unknown[]): readonly Episode[] {
  const listed = values.flatMap((value) => {
    const item = jsonObject(value);
    const url = string(item?.["url"]);
    return url === "" ? [] : [{ name: string(item?.["name"]) || url, url }];
  });
  const stated = listed.map((episode) => statedEpisodeNumber(episode.name));
  const named = stated.every((number) => number !== null) && new Set(stated).size === stated.length;
  // Sources usually list the newest episode first; the numbers (or the order) say which way.
  const first = stated[0] ?? 0;
  const last = stated.at(-1) ?? 0;
  const newestFirst = named ? first > last : true;
  const ordered = newestFirst ? listed.toReversed() : listed;
  return ordered.map((episode, index) => ({ name: episode.name, url: episode.url, number: named ? statedEpisodeNumber(episode.name) ?? index + 1 : index + 1 }))
    .toSorted((a, b) => a.number - b.number);
}

interface DetailView {
  readonly name: string;
  readonly imageUrl: string | null;
  readonly description: string | null;
  readonly genres: readonly string[];
  readonly episodes: readonly Episode[];
}

function detailView(detail: JsonObject | null): DetailView {
  const episodes = detail?.["episodes"] ?? detail?.["chapters"];
  return {
    name: string(detail?.["name"]),
    imageUrl: string(detail?.["imageUrl"]) || null,
    description: string(detail?.["description"]) || null,
    genres: Array.isArray(detail?.["genre"]) ? detail["genre"].filter((genre) => typeof genre === "string") : [],
    episodes: numberedEpisodes(Array.isArray(episodes) ? episodes : []),
  };
}

async function detailResponse(url: URL): Promise<Response> {
  const link = url.searchParams.get("url") ?? "";
  if (link === "") {
    return bad("Choose a show");
  }
  const chosen = sourceById(url.searchParams.get("id"));
  const detail = await runSource(chosen, `extention.getDetail(${JSON.stringify(link)})`, "listing episodes");
  return Response.json(detailView(jsonObject(detail)));
}

/** A show folder name from a title: no path separators, control characters or leading dots. */
function showFolderName(value: unknown): string | null {
  const name = string(value).replaceAll(/[/\\\p{Cc}]/gu, " ").replaceAll(/\s+/gu, " ").trim().replace(/^\.+/u, "");
  return name === "" || name.length > 200 ? null : name;
}

function episodeLabel(number: number): string {
  return Number.isInteger(number) && number < 100 ? String(number).padStart(2, "0") : String(number);
}

async function downloadResponse(body: Body): Promise<Response> {
  const chosen = sourceById(body.id);
  const showFolder = showFolderName(body.showFolder);
  const episodes = Array.isArray(body.episodes) ? body.episodes.flatMap((value) => {
    const item = jsonObject(value);
    const number = item?.["number"];
    return typeof item?.["url"] === "string" && typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 9999
      ? [{ url: item["url"], number }]
      : [];
  }) : [];
  if (showFolder === null || episodes.length === 0 || episodes.length > MAX_EPISODES || episodes.length !== (body.episodes as unknown[]).length) {
    return bad("Choose a show folder and up to 500 episodes");
  }
  const queued = await enqueueSourceEpisodes(episodes.map((episode) => ({
    showFolder, fileName: `${showFolder} - ${episodeLabel(episode.number)}.mp4`, episode: { sourceId: chosen.id, url: episode.url },
  })));
  return queued === "exists" ? bad("Some of those episodes are already in the show folder", 409) : Response.json({ added: queued.length });
}

interface SettingView {
  readonly key: string;
  readonly kind: "list" | "multi" | "toggle" | "text";
  readonly title: string;
  readonly summary: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly value: SettingValue;
}

function settingKind(preference: SourcePreference): SettingView["kind"] {
  if (preference.listPreference !== undefined) {
    return "list";
  }
  if (preference.multiSelectListPreference !== undefined) {
    return "multi";
  }
  return preference.switchPreferenceCompat === undefined && preference.checkBoxPreference === undefined ? "text" : "toggle";
}

function settingView(preference: SourcePreference, value: SettingValue): SettingView {
  const list = preference.listPreference ?? preference.multiSelectListPreference;
  const toggle = preference.switchPreferenceCompat ?? preference.checkBoxPreference;
  const described = list ?? toggle ?? preference.editTextPreference;
  const kind = settingKind(preference);
  const values = list?.entryValues ?? [];
  return {
    key: preference.key, kind, title: described?.title ?? preference.key, summary: described?.summary ?? "",
    options: values.map((entryValue, index) => ({ value: entryValue, label: list?.entries?.[index] ?? entryValue })), value,
  };
}

async function settingsResponse(url: URL): Promise<Response> {
  const chosen = sourceById(url.searchParams.get("id"));
  const preferences = await sourcePreferences(chosen);
  const stored = sourceSettings(chosen.id);
  return Response.json(preferences.map((preference) => settingView(preference, settingValue(preferences, stored, preference.key))));
}

async function saveSettingResponse(body: Body): Promise<Response> {
  const chosen = sourceById(body.id);
  const preferences = await sourcePreferences(chosen);
  const preference = preferences.find((entry) => entry.key === body.key);
  if (preference === undefined || !validSetting(preference, body.value)) {
    return bad("That isn't one of this source's choices");
  }
  saveSourceSetting(chosen.id, preference.key, body.value);
  return Response.json({ ok: true });
}

async function postResponse(pathname: string, body: Body): Promise<Response> {
  switch (pathname) {
    case "/api/sources/repos": {
      const url = URL.parse(string(body.url));
      if (url === null) {
        return bad("Paste a repository link");
      }
      const sources = await addRepo(url.href);
      return Response.json({ sources });
    }
    case "/api/sources/repos/remove": {
      removeSourceRepo(string(body.url));
      return Response.json({ ok: true });
    }
    case "/api/sources/install": {
      const installed = await installSource(string(body.id));
      return Response.json(sourceView(installed));
    }
    case "/api/sources/uninstall": {
      uninstallSource(sourceById(body.id).id);
      return Response.json({ ok: true });
    }
    case "/api/sources/settings": { return await saveSettingResponse(body); }
    case "/api/sources/download": { return await downloadResponse(body); }
    default: { return bad("Not found", 404); }
  }
}

async function getResponse(url: URL): Promise<Response> {
  switch (url.pathname) {
    case "/api/sources": {
      const repos = await listRepos(url.searchParams.get("refresh") === "1");
      return Response.json({ sources: installedSources().map((entry) => sourceView(entry)), repos });
    }
    case "/api/sources/search": { return await searchResponse(url); }
    case "/api/sources/detail": { return await detailResponse(url); }
    case "/api/sources/settings": { return await settingsResponse(url); }
    default: { return bad("Not found", 404); }
  }
}

/** Admin-only, checked by the caller. Plugin and repository failures answer 502 with what went wrong. */
export async function sourcesResponse(req: Request, url: URL): Promise<Response> {
  try {
    if (req.method === "GET") {
      return await getResponse(url);
    }
    const body = (await req.json().catch(() => ({}))) as Body;
    return await postResponse(url.pathname, body);
  } catch (error) {
    if (error instanceof SourceRepoError || error instanceof SourceRequestError) {
      return bad(error.message, 400);
    }
    if (error instanceof SourceError) {
      return bad(error.message, 502);
    }
    if (error instanceof LibraryFileError) {
      return bad(error.message, error.status);
    }
    throw error;
  }
}
