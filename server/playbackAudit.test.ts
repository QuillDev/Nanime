import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "nanime-playback-audit-"));

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true });
});

test("keeps semantic playback history immutable and restorable", async () => {
  const databasePath = join(temporaryDirectory, "audit.sqlite");
  const script = String.raw`
    import { database } from "./server/database.ts";
    database.query("INSERT INTO users (username, is_admin, created_at) VALUES (?, 0, ?)")
      .run("viewer", Date.now());
    const user = database.query("SELECT id, username FROM users WHERE username = ?").get("viewer");
    database.query("INSERT INTO playback_progress (user_id, rel, position, duration, completed, updated_at, dismissed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(user.id, "Example/legacy.mkv", 600, 1200, 1, Date.now(), null);
    const {
      mutatePlayback,
      playbackAuditForUser,
      playbackProgressForUser,
      restorePlaybackAuditEvent,
      shouldRecordPlaybackCheckpoint,
    } = await import("./server/playbackAudit.ts");
    const actor = { id: user.id, username: user.username };
    const initial = {
      rel: "Example/episode-01.mkv",
      position: 0,
      duration: 1200,
      completed: false,
      updatedAt: Date.now(),
      dismissedAt: null,
    };
    mutatePlayback({
      userId: user.id,
      actor,
      rel: initial.rel,
      action: "playback-started",
      origin: "player",
      anilistTarget: { mediaId: 42, episode: 1, totalEpisodes: 12 },
      next: () => initial,
    });
    const smallCheckpoint = shouldRecordPlaybackCheckpoint({
      userId: user.id, rel: initial.rel, position: 60, duration: 1200,
    });
    const meaningfulCheckpoint = shouldRecordPlaybackCheckpoint({
      userId: user.id, rel: initial.rel, position: 301, duration: 1200,
    });
    mutatePlayback({
      userId: user.id,
      actor,
      rel: initial.rel,
      action: "progress-checkpoint",
      origin: "player",
      recordAudit: false,
      next: (previous) => ({ ...previous, position: 60, updatedAt: Date.now() }),
    });
    mutatePlayback({
      userId: user.id,
      actor,
      rel: initial.rel,
      action: "watched",
      origin: "episode-menu",
      anilistTarget: { mediaId: 42, episode: 1, totalEpisodes: 12 },
      next: (previous) => ({ ...previous, completed: true, updatedAt: Date.now() }),
    });
    const watchedEvent = playbackAuditForUser(user.id, 10, initial.rel)[0];
    const restored = restorePlaybackAuditEvent(watchedEvent, actor);
    const events = playbackAuditForUser(user.id, 10, initial.rel);
    let updateBlocked = false;
    let deleteBlocked = false;
    try { database.run("UPDATE playback_audit_log SET action = 'unwatched'"); }
    catch { updateBlocked = true; }
    try { database.run("DELETE FROM playback_audit_log"); }
    catch { deleteBlocked = true; }
    console.log(JSON.stringify({
      smallCheckpoint,
      meaningfulCheckpoint,
      restored,
      current: playbackProgressForUser(user.id),
      events,
      eventCount: database.query("SELECT COUNT(*) AS count FROM playback_audit_log").get().count,
      importedCount: database.query("SELECT COUNT(*) AS count FROM playback_audit_log WHERE action = 'snapshot-imported'").get().count,
      updateBlocked,
      deleteBlocked,
    }));
  `;
  const child = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NANIME_ADMIN_SETUP_TOKEN: "test-token-with-at-least-thirty-two-characters",
      NANIME_DATABASE: databasePath,
    },
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
  const result = JSON.parse(stdout) as {
    readonly smallCheckpoint: boolean;
    readonly meaningfulCheckpoint: boolean;
    readonly restored: { readonly completed: boolean };
    readonly current: readonly { readonly completed: boolean }[];
    readonly events: readonly {
      readonly action: string;
      readonly anilistMediaId: number | null;
      readonly revertsEventId: number | null;
    }[];
    readonly eventCount: number;
    readonly importedCount: number;
    readonly updateBlocked: boolean;
    readonly deleteBlocked: boolean;
  };
  expect(result.smallCheckpoint).toBe(false);
  expect(result.meaningfulCheckpoint).toBe(true);
  expect(result.restored.completed).toBe(false);
  expect(result.current).toHaveLength(2);
  expect(result.current.find((progress) => !progress.completed)?.completed).toBe(false);
  expect(result.events.map((event) => event.action)).toEqual([
    "restored",
    "watched",
    "playback-started",
  ]);
  expect(result.events[0]?.revertsEventId).toBe(3);
  expect(result.events[1]?.anilistMediaId).toBe(42);
  expect(result.eventCount).toBe(4);
  expect(result.importedCount).toBe(1);
  expect(result.updateBlocked).toBe(true);
  expect(result.deleteBlocked).toBe(true);
});
