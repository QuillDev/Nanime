import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.argv[2]!;
const media = join(directory, "media");
await mkdir(join(media, "Parent/Source"), { recursive: true });
await mkdir(join(media, "Parent/Destination"), { recursive: true });
await mkdir(join(media, "Unrelated"));
await mkdir(join(media, "TopSource"));
await mkdir(join(media, "TopDestination"));
await writeFile(join(media, "Parent/Source/episode.mkv"), "original");
let additions = 0;
const qb = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  if (new URL(req.url).pathname.endsWith("/add")) { additions += 1; return new Response("Ok."); }
  return Response.json([]);
} });
process.env["QBITTORRENT_URL"] = `http://127.0.0.1:${qb.port}`;
const { database } = await import("./database.ts");
const { recordPending, markOperation } = await import("./libraryJournal.ts");
const { claimLibraryPaths, libraryPathUnavailable } = await import("./libraryWriters.ts");
const { localLocks, lockAffecting } = await import("./libraryLocks.ts");
const { activeUploadPaths, mediaUploadResponse } = await import("./mediaUpload.ts");
const { torrentsResponse } = await import("./torrents.ts");
const { subtitleUploadResponse } = await import("./subtitles.ts");
const options = { mediaRoot: media, videoExtensions: new Set([".mkv"]), userId: 1, username: "admin" };
const id = randomUUID();
recordPending({ id, kind: "move", actor: { id: 1, username: "admin" }, revertsOperationId: null,
  steps: [{ kind: "move-folder", from: "Parent/Source", to: "Parent/Destination", id: "recorded-entry" }] });
// Pending records do not conflict with their already-held manager lease.
const pendingRelease = claimLibraryPaths(["Parent/Source"]); pendingRelease();
markOperation(id, "recovery-required");
const topId = randomUUID();
recordPending({ id: topId, kind: "move", actor: { id: 1, username: "admin" }, revertsOperationId: null,
  steps: [{ kind: "move-folder", from: "TopSource", to: "TopDestination", id: "recorded-top-entry" }] });
markOperation(topId, "recovery-required");
function upload(folder: string) {
  return mediaUploadResponse(new Request("http://nanime.test/api", { method: "POST", body: JSON.stringify({ folder, fileName: "new.mkv", size: 8 }) }), "/api/media/uploads", options);
}
function torrent(folder: string) {
  const form = new FormData(); form.set("showFolder", folder); form.set("magnet", `magnet:?xt=urn:btih:${"a".repeat(40)}`);
  return torrentsResponse(new Request("http://nanime.test/api/torrents", { method: "POST", body: form }), media, new URL("http://nanime.test/api/torrents"));
}
try {
  for (const scope of ["Parent/Source", "Parent/Destination", "Parent", "Parent/Destination/New", "TopSource", "TopDestination", ""]) {
    assert.throws(() => claimLibraryPaths([scope]), (error: unknown) => (error as { status: number }).status === 423, `durable recovery excludes ${scope}`);
    assert.notEqual(libraryPathUnavailable(scope), null);
    assert.equal(lockAffecting({ global: null, paths: localLocks({ uploads: () => [] }), ownership: "unconfigured" }, scope)?.lock.source, "recovery");
  }
  await Promise.all(["Parent/Source", "Parent/Destination", "Parent/Destination/New", "TopSource", "TopDestination"].map(async (scope) => {
    const [uploaded, added] = await Promise.all([upload(scope), torrent(scope.split("/")[0]!)]);
    assert.equal(uploaded.status, 423, `upload rejects ${scope} before session or folder creation`);
    assert.equal(added.status, 423, `torrent rejects ancestor of ${scope} before its POST`);
  }));
  assert.equal(additions, 0);
  assert.deepEqual(activeUploadPaths(), [], "rejected uploads created no session");
  assert.equal(database.query<{ readonly n: number }, []>("SELECT count(*) AS n FROM library_torrent_additions").get()?.n, 0);
  assert.equal(await Bun.file(join(media, "Parent/Destination/New")).exists(), false);
  assert.deepEqual(await readdir(join(media, "Parent/Destination")), []);
  assert.equal(await readFile(join(media, "Parent/Source/episode.mkv"), "utf8"), "original");
  const form = new FormData(); form.set("offsetSeconds", "0"); form.set("path", "Parent/Source/episode.mkv"); form.set("subtitle", new File(["1\n00:00:00,000 --> 00:00:01,000\nHi\n"], "English.srt"));
  const blocked = await subtitleUploadResponse(new Request("http://nanime.test/api", { method: "POST", body: form }), media, options.videoExtensions);
  assert.equal(blocked.status, 423);
  const release = claimLibraryPaths(["Unrelated"]); release();
  const allowed = await upload("Unrelated"); assert.equal(allowed.status, 200);
  const session = await allowed.json() as { readonly id: string };
  await mediaUploadResponse(new Request("http://nanime.test/api", { method: "DELETE" }), `/api/media/uploads/${session.id}`, options);
  const corruptions = ["not-json", "null", "{}", "[]", '[{"kind":"move-folder","from":42,"to":"Parent/Destination"}]', '[{"kind":"mkdir","from":null,"to":"../escape"}]'];
  const verifyCorruption = async (index: number): Promise<void> => {
    const corrupt = corruptions[index];
    if (corrupt === undefined) { return; }
    database.run("UPDATE library_file_operations SET steps = ? WHERE id = ?", [corrupt, id]);
    assert.throws(() => claimLibraryPaths(["Unrelated"]), (error: unknown) => (error as { status: number }).status === 423, `malformed scope ${corrupt} fails closed`);
    const rejected = await upload("Unrelated");
    assert.equal(rejected.status, 423);
    return verifyCorruption(index + 1);
  };
  await verifyCorruption(0);
  markOperation(id, "rolled-back");
  markOperation(topId, "rolled-back");
  const restored = claimLibraryPaths(["Parent/Source"]); restored();
  console.log("recovery admission passed");
} finally { qb.stop(true); }
