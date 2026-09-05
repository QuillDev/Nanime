import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runScript(databasePath: string, script: string): Promise<void> {
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    env: { ...process.env, NANIME_DATABASE: databasePath, NANIME_ADMIN_SETUP_TOKEN: "party-migration-test-setup-token-0001" },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).toBe("");
  expect(code).toBe(0);
}

test("the membership migration preserves pre-existing session state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanime-party-migration-"));
  const databasePath = join(directory, "test.sqlite");
  try {
    await runScript(databasePath, `
      import { database } from "./server/database.ts";
      database.run("DROP TABLE watch_together_members");
      database.run("DROP TABLE watch_together");
      database.run("CREATE TABLE watch_together (id TEXT PRIMARY KEY, host_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, host_token TEXT NOT NULL, rel TEXT NOT NULL, position REAL NOT NULL, paused INTEGER NOT NULL, rate REAL NOT NULL, updated_at INTEGER NOT NULL)");
      const user = database.query("SELECT id FROM users WHERE username = 'admin'").get();
      database.query("INSERT INTO watch_together VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("existing-party", user.id, "example-hash", "Example/episode.mp4", 42, 1, 1.5, 1000);
      database.close();
    `);
    await runScript(databasePath, `
      import { expect } from "bun:test";
      import { database } from "./server/database.ts";
      const room = database.query("SELECT rel, position, paused, rate, updated_at, active_at, generation, host_member_id FROM watch_together WHERE id = ?").get("existing-party");
      expect(room).toEqual({ rel: "Example/episode.mp4", position: 42, paused: 1, rate: 1.5, updated_at: 1000, active_at: 1000, generation: 1, host_member_id: null });
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      database.close();
    `);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
