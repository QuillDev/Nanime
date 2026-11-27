import { createHostMembership } from "./watchTogetherMembers.ts";
import { createHash, randomBytes } from "node:crypto";
import { database, db, execute, queryOne, sql, type WatchTogetherRow, WatchTogetherRowSchema } from "./database.ts";
import { WATCH_TOGETHER_TIMEOUT, PARTY_IDLE_TIMEOUT, type PartyMemberCredentials, type WatchTogetherState } from "../shared/watchTogether.ts";

type Room = WatchTogetherRow;

interface Playback {
  readonly position: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly member?: PartyMemberCredentials;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function state(room: Room, now: number): WatchTogetherState {
  return {
    id: room.id, rel: room.rel === "" ? null : room.rel, position: room.position,
    paused: room.paused === 1, rate: room.rate,
    updatedAt: room.updated_at, serverTime: now,
  };
}

export function getWatchTogether(id: string, now = Date.now()): WatchTogetherState | null {
  const room = queryOne(db.selectFrom("watch_together").selectAll().where("id", "=", id), WatchTogetherRowSchema);
  return room === null || now - room.updated_at > WATCH_TOGETHER_TIMEOUT ? null : state(room, now);
}

export function createWatchTogether(userId: number, rel: string, playback: Playback) {
  const id = randomBytes(24).toString("base64url");
  const hostToken = randomBytes(32).toString("base64url");
  const now = Date.now();
  database.transaction(() => {
    execute(sql`DELETE FROM watch_together WHERE (host_member_id IS NULL AND generation = 1 AND (host_id = ${userId} OR updated_at < ${now - WATCH_TOGETHER_TIMEOUT})) OR active_at < ${now - PARTY_IDLE_TIMEOUT}`);
    execute(db.insertInto("watch_together").values({
      id, host_id: userId, host_token: tokenHash(hostToken), rel, position: playback.position, paused: Number(playback.paused), rate: playback.rate, updated_at: now, active_at: now,
    }));
    if (playback.member !== undefined) { createHostMembership({ ...playback.member, id, userId }, now); }
  })();
  return { id, hostToken };
}

export function updateWatchTogether(options: {
  readonly id: string;
  readonly userId: number;
  readonly hostToken: string;
  readonly playback: Playback & { readonly rel?: string | null };
}, now = Date.now()): boolean {
  const { id, userId, hostToken, playback } = options;
  return execute(sql`UPDATE watch_together SET position = ${playback.position}, paused = ${Number(playback.paused)}, rate = ${playback.rate}, updated_at = ${now},
    rel = CASE WHEN ${Number(playback.rel !== undefined)} THEN ${playback.rel ?? ""} ELSE rel END
    WHERE id = ${id} AND host_id = ${userId} AND host_token = ${tokenHash(hostToken)} AND host_member_id IS NULL AND updated_at >= ${now - WATCH_TOGETHER_TIMEOUT}`) === 1;
}

export function endWatchTogether(id: string, userId: number, hostToken: string): boolean {
  return execute(db.deleteFrom("watch_together").where("id", "=", id).where("host_id", "=", userId)
    .where("host_token", "=", tokenHash(hostToken)).where("host_member_id", "is", null)) > 0;
}
