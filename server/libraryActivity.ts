import type {
  LibraryActivityEvent,
  LibraryActivityState,
  MappingActivityState,
} from "../shared/types.ts";
import { database } from "./database.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";

export interface ActivityActor {
  readonly id: number;
  readonly username: string;
}

interface ActivityRow {
  readonly id: number;
  readonly actor_user_id: number;
  readonly actor_username: string;
  readonly action: LibraryActivityEvent["action"];
  readonly subject: string;
  readonly previous_state: string | null;
  readonly next_state: string;
  readonly created_at: number;
}

const insertActivity = database.query<void, [
  number, string, LibraryActivityEvent["action"], string, string | null, string, number,
]>(`
  INSERT INTO library_activity_log (
    actor_user_id, actor_username, action, subject,
    previous_state, next_state, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const listActivity = database.query<ActivityRow, [number]>(`
  SELECT id, actor_user_id, actor_username, action, subject,
    previous_state, next_state, created_at
  FROM library_activity_log
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

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
  insertActivity.run(
    actor.id,
    actor.username,
    "media-uploaded",
    path,
    null,
    storedState(next) as string,
    Date.now(),
  );
}

export function recordMappingActivity(options: {
  readonly actor: ActivityActor;
  readonly key: string;
  readonly previous: AnimeMetadata | undefined;
  readonly next: AnimeMetadata;
  readonly write: () => void;
}): void {
  const commit = database.transaction(() => {
    options.write();
    insertActivity.run(
      options.actor.id,
      options.actor.username,
      "mapping-updated",
      options.key,
      storedState(options.previous === undefined ? null : mappingState(options.key, options.previous)),
      storedState(mappingState(options.key, options.next)) as string,
      Date.now(),
    );
  });
  commit();
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
  return Response.json(listActivity.all(limit).map((row) => eventFromRow(row)));
}
