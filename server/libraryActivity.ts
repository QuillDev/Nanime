import type { FileOperationActivityState } from "../shared/libraryFiles.ts";
import type {
  LibraryActivityEvent,
  LibraryActivityState,
  MappingActivityState,
} from "../shared/types.ts";
import { database, db, execute, type LibraryActivityRow, LibraryActivityRowSchema, queryRows } from "./database.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";

export interface ActivityActor {
  readonly id: number;
  readonly username: string;
}

type ActivityRow = LibraryActivityRow;

function insertActivity(row: Omit<ActivityRow, "id">): void {
  execute(db.insertInto("library_activity_log").values(row));
}

function storedState(state: LibraryActivityState | null): string | null {
  return state === null ? null : JSON.stringify(state);
}

function parsedState(state: string): LibraryActivityState {
  return JSON.parse(state) as LibraryActivityState;
}

function mappingState(key: string, media: AnimeMetadata): MappingActivityState {
  return {
    kind: "mapping",
    key,
    provider: media.provider,
    mediaId: media.id,
    anilistId: media.anilistId,
    title: media.title.english ?? media.title.romaji,
  };
}

export function recordUploadActivity(
  actor: ActivityActor,
  path: string,
  size: number,
): void {
  const next = { kind: "upload", path, size } as const;
  insertActivity({
    actor_user_id: actor.id,
    actor_username: actor.username,
    action: "media-uploaded",
    subject: path,
    previous_state: null,
    next_state: storedState(next) as string,
    created_at: Date.now(),
  });
}

export function recordMappingActivity(options: {
  readonly actor: ActivityActor;
  readonly key: string;
  readonly previous: AnimeMetadata | undefined;
  readonly next: AnimeMetadata;
  readonly write: () => void;
}): void {
  // The write goes last: if it throws, the activity entry rolls back with it.
  const commit = database.transaction(() => {
    insertActivity({
      actor_user_id: options.actor.id,
      actor_username: options.actor.username,
      action: "mapping-updated",
      subject: options.key,
      previous_state: storedState(options.previous === undefined ? null : mappingState(options.key, options.previous)),
      next_state: storedState(mappingState(options.key, options.next)) as string,
      created_at: Date.now(),
    });
    options.write();
  });
  commit();
}

/**
 * Appends a file operation entry. Callers run this inside the transaction
 * that commits the operation's state change, so both land or neither does.
 */
export interface FileOperationActivity {
  readonly actor: ActivityActor;
  readonly action: LibraryActivityEvent["action"];
  readonly subject: string;
  readonly next: FileOperationActivityState;
}

export function insertFileOperationActivity(entry: FileOperationActivity): void {
  const { actor, action, subject, next } = entry;
  insertActivity({
    actor_user_id: actor.id, actor_username: actor.username, action, subject,
    previous_state: null, next_state: JSON.stringify(next), created_at: Date.now(),
  });
}

function eventFromRow(row: ActivityRow): LibraryActivityEvent {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    action: row.action,
    subject: row.subject,
    previous: row.previous_state === null ? null : parsedState(row.previous_state),
    next: parsedState(row.next_state),
    createdAt: row.created_at,
  };
}

export function libraryActivityResponse(url: URL): Response {
  const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const rows = queryRows(db.selectFrom("library_activity_log").selectAll()
    .orderBy("created_at", "desc").orderBy("id", "desc").limit(limit), LibraryActivityRowSchema);
  return Response.json(rows.map((row) => eventFromRow(row)));
}
