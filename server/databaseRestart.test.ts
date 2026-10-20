import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedEnvironment, runScript } from "./testProcess.ts";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "nanime-database-restart-"));
const environment = isolatedEnvironment(temporaryDirectory);

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true });
});

/** Each call is a fresh server process over the same database file. */
async function runDatabaseScript(script: string): Promise<string> {
  const result = await runScript(script, environment);
  expect({ code: result.code, error: result.error }).toEqual({ code: 0, error: "" });
  return result.output;
}

test("preserves manually watched state when the database restarts", async () => {
  await runDatabaseScript(`
    import { database } from "./server/database.ts";
    database.query("INSERT INTO users (username, is_admin, created_at) VALUES (?, 0, ?)")
      .run("viewer", Date.now());
    const user = database.query("SELECT id FROM users WHERE username = ?").get("viewer");
    database.query("INSERT INTO playback_progress (user_id, rel, position, duration, completed, updated_at, dismissed_at) VALUES (?, ?, ?, ?, 1, ?, NULL)")
      .run(user.id, "Example/episode-01.mkv", 100, 1200, Date.now());
  `);
  const output = await runDatabaseScript(`
    import { database } from "./server/database.ts";
    const progress = database.query("SELECT completed, position, duration FROM playback_progress WHERE rel = ?")
      .get("Example/episode-01.mkv");
    console.log(JSON.stringify(progress));
  `);
  expect(JSON.parse(output)).toEqual({ completed: 1, position: 100, duration: 1200 });
});

test("requeues interrupted offline preparation when the database restarts", async () => {
  await runDatabaseScript(`
    import { database } from "./server/database.ts";
    database.query("INSERT INTO offline_media_artifacts (id, source_rel, source_size, source_modified_at, audio_index, direct, output_name, status, progress, speed, duration, size_bytes, mime_type, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, 'preparing', 0.75, 1.5, 1200, NULL, 'video/mp4', NULL, ?, ?)")
      .run("offline-restart-artifact", "Example/episode-02.mkv", 1000, 1234, 1, "offline-restart-artifact.mp4", Date.now(), Date.now());
  `);
  const output = await runDatabaseScript(`
    import { database } from "./server/database.ts";
    const artifact = database.query("SELECT status, progress, speed, error FROM offline_media_artifacts WHERE id = ?")
      .get("offline-restart-artifact");
    console.log(JSON.stringify(artifact));
  `);
  expect(JSON.parse(output)).toEqual({ status: "queued", progress: 0, speed: 0, error: null });
});
