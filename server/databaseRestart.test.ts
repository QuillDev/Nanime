import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "nanime-database-restart-"));
const databasePath = join(temporaryDirectory, "restart.sqlite");
const environment = {
  ...process.env,
  NANIME_ADMIN_SETUP_TOKEN: "test-token-with-at-least-thirty-two-characters",
  NANIME_DATABASE: databasePath,
};

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true });
});

async function runDatabaseScript(script: string): Promise<string> {
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    cwd: process.cwd(),
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
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
