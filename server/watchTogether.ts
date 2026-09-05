import { createHostMembership } from "./watchTogetherMembers.ts";
import { createHash, randomBytes } from "node:crypto";
import { database } from "./database.ts";
import { WATCH_TOGETHER_TIMEOUT, PARTY_IDLE_TIMEOUT, type PartyMemberCredentials, type WatchTogetherState } from "../shared/watchTogether.ts";

interface Room {
  readonly id: string;
  readonly host_id: number;
  readonly host_token: string;
  readonly rel: string;
  readonly position: number;
  readonly paused: number;
  readonly rate: number;
  readonly updated_at: number;
}

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
  const room = database.query<Room, [string]>("SELECT * FROM watch_together WHERE id = ?").get(id);
  return room === null || now - room.updated_at > WATCH_TOGETHER_TIMEOUT ? null : state(room, now);
}

export function createWatchTogether(userId: number, rel: string, playback: Playback) {
  const id = randomBytes(24).toString("base64url");
  const hostToken = randomBytes(32).toString("base64url");
  const now = Date.now();
  database.transaction(() => {
    database.query("DELETE FROM watch_together WHERE (host_member_id IS NULL AND generation = 1 AND (host_id = ? OR updated_at < ?)) OR active_at < ?")
      .run(userId, now - WATCH_TOGETHER_TIMEOUT, now - PARTY_IDLE_TIMEOUT);
    database.query(`INSERT INTO watch_together
      (id, host_id, host_token, rel, position, paused, rate, updated_at, active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, userId, tokenHash(hostToken), rel, playback.position, Number(playback.paused), playback.rate, now, now);
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
  return database.query(`UPDATE watch_together SET position = ?, paused = ?, rate = ?, updated_at = ?, rel = CASE WHEN ? THEN ? ELSE rel END
    WHERE id = ? AND host_id = ? AND host_token = ? AND host_member_id IS NULL AND updated_at >= ?`)
    .run(playback.position, Number(playback.paused), playback.rate, now, Number(playback.rel !== undefined), playback.rel ?? "",
      id, userId, tokenHash(hostToken), now - WATCH_TOGETHER_TIMEOUT).changes === 1;
}

export function endWatchTogether(id: string, userId: number, hostToken: string): boolean {
  return database.query("DELETE FROM watch_together WHERE id = ? AND host_id = ? AND host_token = ? AND host_member_id IS NULL")
    .run(id, userId, tokenHash(hostToken)).changes > 0;
}
