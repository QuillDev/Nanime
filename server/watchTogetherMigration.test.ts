import { expect, test } from "bun:test";
import { isolatedEnvironment, runScript, withTemporaryDirectory, type ChildEnvironment } from "./testProcess.ts";

async function runCleanly(script: string, environment: ChildEnvironment): Promise<void> {
  const result = await runScript(script, environment);
  expect({ code: result.code, error: result.error }).toEqual({ code: 0, error: "" });
}

test("the membership migration preserves pre-existing session state", async () => {
  await withTemporaryDirectory("nanime-party-migration-", async (directory) => {
    const environment = isolatedEnvironment(directory);
    await runCleanly(`
      import { database } from "./server/database.ts";
      database.run("DROP TABLE watch_together_members");
      database.run("DROP TABLE watch_together");
      database.run("CREATE TABLE watch_together (id TEXT PRIMARY KEY, host_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, host_token TEXT NOT NULL, rel TEXT NOT NULL, position REAL NOT NULL, paused INTEGER NOT NULL, rate REAL NOT NULL, updated_at INTEGER NOT NULL)");
      const user = database.query("SELECT id FROM users WHERE username = 'admin'").get();
      database.query("INSERT INTO watch_together VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("existing-party", user.id, "example-hash", "Example/episode.mp4", 42, 1, 1.5, 1000);
      database.close();
    `, environment);
    await runCleanly(`
      import { expect } from "bun:test";
      import { database } from "./server/database.ts";
      const room = database.query("SELECT rel, position, paused, rate, updated_at, active_at, generation, host_member_id FROM watch_together WHERE id = ?").get("existing-party");
      expect(room).toEqual({ rel: "Example/episode.mp4", position: 42, paused: 1, rate: 1.5, updated_at: 1000, active_at: 1000, generation: 1, host_member_id: null });
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      database.close();
    `, environment);
  });
});
