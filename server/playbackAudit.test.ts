import { expect, test } from "bun:test";
import { isolatedEnvironment, runScript, withTemporaryDirectory } from "./testProcess.ts";

const auditScript = String.raw`
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
    } = await import("./server/playbackAudit.ts");
    const { recordMappingActivity, recordUploadActivity } = await import("./server/libraryActivity.ts");
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
    mutatePlayback({
      userId: user.id,
      actor,
      rel: initial.rel,
      action: "playback-stopped",
      origin: "player",
      recordAudit: false,
      next: (previous) => ({ ...previous, position: 60, updatedAt: Date.now() }),
    });
    mutatePlayback({
      userId: user.id,
      actor,
      rel: initial.rel,
      action: "playback-stopped",
      origin: "player",
      sessionSeconds: 90,
      next: (previous) => previous,
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
    recordUploadActivity(actor, "Example/uploaded.mkv", 2048);
    const mapped = {
      provider: "anilist",
      id: 42,
      anilistId: 42,
      title: { english: "Example", romaji: "Example" },
    };
    recordMappingActivity({
      actor,
      key: "show:Example",
      previous: undefined,
      next: mapped,
      write: () => database.query("INSERT INTO media_metadata (key, payload, updated_at) VALUES (?, ?, ?)")
        .run("show:Example", JSON.stringify(mapped), Date.now()),
    });
    let updateBlocked = false;
    let deleteBlocked = false;
    let activityDeleteBlocked = false;
    try { database.run("UPDATE playback_audit_log SET action = 'unwatched'"); }
    catch { updateBlocked = true; }
    try { database.run("DELETE FROM playback_audit_log"); }
    catch { deleteBlocked = true; }
    try { database.run("DELETE FROM library_activity_log"); }
    catch { activityDeleteBlocked = true; }
    console.log(JSON.stringify({
      restored,
      current: playbackProgressForUser(user.id),
      events,
      eventCount: database.query("SELECT COUNT(*) AS count FROM playback_audit_log").get().count,
      importedCount: database.query("SELECT COUNT(*) AS count FROM playback_audit_log WHERE action = 'snapshot-imported'").get().count,
      updateBlocked,
      deleteBlocked,
      activityDeleteBlocked,
      libraryActions: database.query("SELECT action FROM library_activity_log ORDER BY id").all(),
    }));
`;

test("keeps semantic playback history immutable and restorable", async () => {
  const { code, output, error } = await withTemporaryDirectory("nanime-playback-audit-", (directory) => runScript(auditScript, isolatedEnvironment(directory)));
  expect({ code, error }).toEqual({ code: 0, error: "" });
  const result = JSON.parse(output) as {
    readonly restored: { readonly completed: boolean };
    readonly current: readonly { readonly completed: boolean }[];
    readonly events: readonly {
      readonly action: string;
      readonly anilistMediaId: number | null;
      readonly revertsEventId: number | null;
      readonly sessionSeconds: number | null;
    }[];
    readonly eventCount: number;
    readonly importedCount: number;
    readonly updateBlocked: boolean;
    readonly deleteBlocked: boolean;
    readonly activityDeleteBlocked: boolean;
    readonly libraryActions: readonly { readonly action: string }[];
  };
  expect(result.restored.completed).toBe(false);
  expect(result.current).toHaveLength(2);
  expect(result.current.find((progress) => !progress.completed)?.completed).toBe(false);
  expect(result.events.map((event) => event.action)).toEqual([
    "restored",
    "watched",
    "playback-stopped",
    "playback-started",
  ]);
  expect(result.events[0]?.revertsEventId).toBe(4);
  expect(result.events[1]?.anilistMediaId).toBe(42);
  expect(result.events[2]?.sessionSeconds).toBe(90);
  expect(result.eventCount).toBe(5);
  expect(result.importedCount).toBe(1);
  expect(result.updateBlocked).toBe(true);
  expect(result.deleteBlocked).toBe(true);
  expect(result.activityDeleteBlocked).toBe(true);
  expect(result.libraryActions.map((event) => event.action)).toEqual([
    "media-uploaded",
    "mapping-updated",
  ]);
});
