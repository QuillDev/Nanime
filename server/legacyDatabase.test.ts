import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { startLibraryTestServer, writeLibraryFixture } from "./libraryFilesTestServer.ts";

/** A database file as single-user Nanime wrote it, before accounts and job progress existed. */
async function writeLegacyDatabase(media: string): Promise<void> {
  await writeLibraryFixture(media);
  const database = new Database(join(media, "..", "nanime.sqlite"), { create: true });
  database.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  )`);
  database.run("INSERT INTO users (username, is_admin, created_at) VALUES ('admin', 1, 1)");
  database.run(`CREATE TABLE playback_progress (
    rel TEXT PRIMARY KEY, position REAL NOT NULL, duration REAL NOT NULL, completed INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  database.run("INSERT INTO playback_progress VALUES ('Show/Episode 01.mkv', 300.5, 1400, 0, 1000)");
  database.run(`CREATE TABLE transcode_jobs (
    id TEXT PRIMARY KEY, source_rel TEXT NOT NULL, preset TEXT NOT NULL, output_rel TEXT NOT NULL, status TEXT NOT NULL,
    input_size INTEGER NOT NULL, output_size INTEGER, error TEXT, original_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  database.run(`INSERT INTO transcode_jobs (id, source_rel, preset, output_rel, status, input_size, error, created_at, updated_at)
    VALUES ('old-job', 'Show/Episode 01.mkv', 'compatibility', '.nanime-transcodes/old.mkv', 'failed', 8, 'encoder crashed', 2, 3)`);
  database.close();
}

test("a database file from before accounts opens with its watch progress and transcode history", async () => {
  const server = await startLibraryTestServer(writeLegacyDatabase);
  try {
    const progress = await server.request("/api/progress");
    expect(await progress.json()).toEqual([
      { rel: "Show/Episode 01.mkv", position: 300.5, duration: 1400, completed: false, updatedAt: 1000, dismissedAt: null },
    ]);
    const history = await server.request(`/api/progress/history?rel=${encodeURIComponent("Show/Episode 01.mkv")}`);
    expect(await history.json()).toMatchObject([{ action: "snapshot-imported", origin: "migration", actorUsername: "admin", previous: null, next: { position: 300.5 } }]);
    const transcodes = await server.request("/api/transcodes");
    expect(await transcodes.json()).toMatchObject([
      { id: "old-job", status: "failed", error: "encoder crashed", progress: 0, speed: 0, startedAt: null, originalDeleted: false },
    ]);
  } finally {
    await server.close();
  }
});
