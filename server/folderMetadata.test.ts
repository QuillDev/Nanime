import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fixtureMapping, getJson, startLibraryTestServer, type LibraryTestServer } from "./libraryFilesTestServer.ts";

const RELEASE = "[Group] Fixture Title (Season 02) [1080p]";
let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function writeTree(media: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const abs = join(media, ...path.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
}

async function fileText(target: LibraryTestServer, path: string): Promise<string> {
  return await readFile(join(target.media, ...path.split("/")), "utf8");
}

type Metadata = Readonly<Record<string, { readonly id: number; readonly title: { readonly english: string | null } }>>;

test("stored mappings move into the folders' nanime.json once, and the files decide from then on", async () => {
  const keptFile = `${JSON.stringify({ version: 1, show: { provider: "anilist", id: 99, title: "Kept by file" } }, null, 2)}\n`;
  server = await startLibraryTestServer((media) => writeTree(media, {
    [`${RELEASE}/Fixture Title - 01.mkv`]: "episode",
    "Kept Show/Kept Show - 01.mkv": "episode",
    "Kept Show/nanime.json": keptFile,
  }));
  const target = server;
  const database = target.database();
  try {
    const insert = database.query("INSERT INTO media_metadata (key, payload, updated_at) VALUES (?, ?, 1)");
    insert.run("show:Fixture Title", fixtureMapping("Fixture Title", 21));
    insert.run("season:Fixture Title / Season 2", fixtureMapping("Fixture Title Season 2", 22));
    insert.run("show:Kept Show", fixtureMapping("Kept Show from the database", 23));
    insert.run("show:Gone Show", fixtureMapping("Gone Show", 24));
  } finally {
    database.close();
  }

  const migrated = await getJson<Metadata>(target, "/api/metadata");
  expect(Object.keys(migrated).toSorted()).toEqual(["season:Fixture Title / Season 2", "show:Fixture Title", "show:Kept Show"]);
  expect(migrated["show:Fixture Title"]?.title.english).toBe("Fixture Title");
  expect(migrated["season:Fixture Title / Season 2"]?.title.english).toBe("Fixture Title Season 2");
  expect(migrated["show:Kept Show"]?.title.english).toBe("Kept by file");
  expect(await fileText(target, `${RELEASE}/nanime.json`)).toBe(`{
  "version": 1,
  "show": {
    "provider": "jikan",
    "id": 21,
    "anilistId": null
  },
  "season": {
    "provider": "jikan",
    "id": 22,
    "anilistId": null
  }
}
`);
  expect(await fileText(target, "Kept Show/nanime.json")).toBe(keptFile);

  // A hand edit wins over everything the database still holds.
  await writeFile(join(target.media, RELEASE, "nanime.json"), JSON.stringify({ version: 1, show: { provider: "anilist", id: 31, title: "Edited by hand" } }));
  const edited = await getJson<Metadata>(target, "/api/metadata");
  expect(edited["show:Fixture Title"]).toMatchObject({ id: 31, title: { english: "Edited by hand" } });
  expect(edited["season:Fixture Title / Season 2"]).toBeUndefined();
});

test("an unreadable nanime.json leaves only its own folder unmatched", async () => {
  server = await startLibraryTestServer((media) => writeTree(media, {
    "Broken Show/Broken Show - 01.mkv": "episode",
    "Broken Show/nanime.json": "{ not json",
    "Jikan Show/Jikan Show - 01.mkv": "episode",
    "Jikan Show/nanime.json": JSON.stringify({ version: 1, show: { provider: "jikan", id: 5, title: "Manual titles are AniList-only" } }),
    "Fine Show/Fine Show - 01.mkv": "episode",
    "Fine Show/nanime.json": JSON.stringify({ version: 1, show: { provider: "anilist", id: 7, title: "Fine Show" } }),
  }));
  const metadata = await getJson<Metadata>(server, "/api/metadata");
  expect(Object.keys(metadata)).toEqual(["show:Fine Show"]);
  expect(server.log()).toContain("Ignoring nanime.json in “Broken Show”");
});

test("linking a show writes every release folder that shares its card, and records the change", async () => {
  server = await startLibraryTestServer((media) => writeTree(media, {
    "[Group] Shared Show (Season 01)/Shared Show - 01.mkv": "episode",
    "[Other] Shared Show (Season 02)/Shared Show - 01.mkv": "episode",
  }));
  const target = server;
  const link = await target.request("/api/anilist/link", { method: "POST", body: JSON.stringify({ key: "show:Shared Show", id: 41, manualTitle: "Shared Show" }) });
  expect(link.status).toBe(200);
  const files = await Promise.all(["[Group] Shared Show (Season 01)", "[Other] Shared Show (Season 02)"].map((folder) => fileText(target, `${folder}/nanime.json`)));
  expect(files.map((text) => JSON.parse(text) as unknown)).toEqual([0, 1].map(() => ({ version: 1, show: { provider: "anilist", id: 41, title: "Shared Show" } })));
  const activity = await getJson<readonly { readonly action: string; readonly subject: string }[]>(target, "/api/library/activity");
  expect(activity.map((event) => [event.action, event.subject])).toEqual([["mapping-updated", "show:Shared Show"]]);

  const missing = await target.request("/api/anilist/link", { method: "POST", body: JSON.stringify({ key: "show:Not In Library", id: 42, manualTitle: "Nope" }) });
  expect(missing.status).toBe(404);
  const after = await getJson<readonly unknown[]>(target, "/api/library/activity");
  expect(after).toHaveLength(1);
});
