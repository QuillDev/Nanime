import { createHash, randomUUID } from "node:crypto";
import { database } from "./database.ts";
import { PARTY_HOST_GRACE, PARTY_IDLE_TIMEOUT, type PartyMemberCredentials, type PartyState } from "../shared/watchTogether.ts";

export interface PartyActor extends PartyMemberCredentials {
  readonly id: string;
  readonly userId: number;
}
interface Member {
  readonly id: string;
  readonly user_id: number;
  readonly connection_id: string;
  readonly incarnation: number;
  readonly seen_at: number;
  readonly left_at: number | null;
}
interface Room {
  readonly id: string;
  readonly host_id: number;
  readonly host_member_id: string | null;
  readonly generation: number;
  readonly rel: string;
  readonly position: number;
  readonly paused: number;
  readonly rate: number;
  readonly updated_at: number;
  readonly active_at: number;
}

function hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function roomFor(id: string): Room | null {
  return database.query<Room, [string]>("SELECT * FROM watch_together WHERE id = ?").get(id);
}
function memberFor(actor: PartyActor): Member | null {
  return database.query<Member, [string, string]>("SELECT * FROM watch_together_members WHERE room_id = ? AND token_hash = ?")
    .get(actor.id, hash(actor.memberToken));
}
function authenticatedMember(actor: PartyActor): Member | null {
  const member = memberFor(actor);
  return member !== null && member.left_at === null && member.user_id === actor.userId &&
    member.connection_id === actor.connectionId && member.incarnation === actor.incarnation ? member : null;
}
function addMember(actor: PartyActor, now: number): string {
  const id = randomUUID();
  database.query(`INSERT INTO watch_together_members
    (id, room_id, user_id, token_hash, connection_id, incarnation, joined_at, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, actor.id, actor.userId, hash(actor.memberToken), actor.connectionId, actor.incarnation, now, now);
  return id;
}
export function createHostMembership(actor: PartyActor, now: number): void {
  const memberId = addMember(actor, now);
  database.query("UPDATE watch_together SET host_member_id = ?, active_at = ? WHERE id = ?").run(memberId, now, actor.id);
}
function resumeMember(actor: PartyActor, member: Member, now: number): boolean {
  if (member.left_at !== null || member.user_id !== actor.userId || actor.incarnation < member.incarnation) { return false; }
  if (actor.incarnation === member.incarnation && actor.connectionId !== member.connection_id) { return false; }
  if (actor.incarnation > member.incarnation) {
    database.query("UPDATE watch_together SET generation = generation + 1 WHERE id = ? AND host_member_id = ?").run(actor.id, member.id);
  }
  database.query(`UPDATE watch_together_members SET connection_id = ?, incarnation = ?, seen_at = ?,
    joined_at = CASE WHEN seen_at < ? THEN ? ELSE joined_at END WHERE id = ?`)
    .run(actor.connectionId, actor.incarnation, now, now - PARTY_HOST_GRACE, now, member.id);
  return true;
}
function heldPosition(room: Room, now: number): number {
  return room.position + (room.paused === 1 ? 0 : Math.min(Math.max(now - room.updated_at, 0), 5000) / 1000 * room.rate);
}
function transferHost(room: Room, now: number): void {
  const next = database.query<{ readonly id: string }, [string, number]>(`SELECT id FROM watch_together_members
    WHERE room_id = ? AND left_at IS NULL AND seen_at >= ? ORDER BY joined_at, id LIMIT 1`).get(room.id, now - PARTY_HOST_GRACE);
  const position = heldPosition(room, now);
  database.query(`UPDATE watch_together SET host_member_id = ?, generation = generation + 1,
    position = ?, paused = 1, updated_at = ? WHERE id = ?`).run(next?.id ?? null, position, now, room.id);
}
function electHost(room: Room, now: number): void {
  const current = database.query<Member, [string]>("SELECT * FROM watch_together_members WHERE id = ?").get(room.host_member_id ?? "");
  if (current !== null && current.left_at === null && current.seen_at >= now - PARTY_HOST_GRACE) { return; }
  // Let an existing, pre-membership host finish upgrading during the grace period.
  if (room.host_member_id === null && room.generation === 1 && room.updated_at >= now - PARTY_HOST_GRACE) { return; }
  transferHost(room, now);
}
function reply(room: Room, memberId: string, now: number): PartyState {
  const host = database.query<{ readonly username: string }, [string]>(`SELECT users.username FROM users
    JOIN watch_together_members ON users.id = watch_together_members.user_id WHERE watch_together_members.id = ?`).get(room.host_member_id ?? "");
  const members = database.query<{ readonly id: string; readonly username: string }, [string, number]>(`SELECT m.id, users.username
    FROM watch_together_members m JOIN users ON users.id = m.user_id
    WHERE m.room_id = ? AND m.left_at IS NULL AND m.seen_at >= ? ORDER BY m.joined_at, m.id`).all(room.id, now - PARTY_HOST_GRACE);
  const stale = now - room.updated_at > 5000;
  return {
    id: room.id, rel: room.rel === "" ? null : room.rel, position: stale ? heldPosition(room, now) : room.position,
    paused: room.paused === 1 || stale, rate: room.rate, updatedAt: room.updated_at, serverTime: now,
    isHost: room.host_member_id === memberId, generation: room.generation, hostName: host?.username ?? null, members: members.length,
    memberList: members.map((member) => ({ id: member.id, name: member.username, isHost: member.id === room.host_member_id, isSelf: member.id === memberId })),
  };
}

export function partyPresence(actor: PartyActor, now = Date.now()): PartyState | null {
  return database.transaction(() => {
    const room = roomFor(actor.id);
    if (room === null || now - room.active_at > PARTY_IDLE_TIMEOUT) { return null; }
    if (room.host_member_id !== null) { electHost(room, now); }
    const previous = memberFor(actor);
    if (previous !== null && !resumeMember(actor, previous, now)) { return null; }
    const memberId = previous?.id ?? addMember(actor, now);
    electHost(roomFor(actor.id) ?? room, now);
    database.query("UPDATE watch_together SET active_at = ? WHERE id = ?").run(now, actor.id);
    return reply(roomFor(actor.id) ?? room, memberId, now);
  })();
}

export interface PartyPlayback {
  readonly rel: string | null;
  readonly position: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly generation: number;
}
export function partyPlayback(actor: PartyActor, playback: PartyPlayback, now = Date.now()): PartyState | null {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null) { return null; }
    electHost(room, now);
    const changed = database.query(`UPDATE watch_together SET rel = ?, position = ?, paused = ?, rate = ?, updated_at = ?, active_at = ?
      WHERE id = ? AND host_member_id = ? AND generation = ?`).run(playback.rel ?? "", playback.position, Number(playback.paused), playback.rate, now, now, actor.id, member.id, playback.generation);
    return changed.changes === 1 ? reply(roomFor(actor.id) ?? room, member.id, now) : null;
  })();
}
export function leaveParty(actor: PartyActor, now = Date.now()): boolean {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null) { return false; }
    database.query("UPDATE watch_together_members SET left_at = ? WHERE id = ?").run(now, member.id);
    if (room.host_member_id === member.id) { transferHost(room, now); }
    database.query(`DELETE FROM watch_together WHERE id = ? AND NOT EXISTS
      (SELECT 1 FROM watch_together_members WHERE room_id = ? AND left_at IS NULL AND seen_at >= ?)`).run(actor.id, actor.id, now - PARTY_HOST_GRACE);
    return true;
  })();
}
export function endParty(actor: PartyActor, generation: number, now = Date.now()): boolean {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null) { return false; }
    electHost(room, now);
    return database.query("DELETE FROM watch_together WHERE id = ? AND host_member_id = ? AND generation = ?")
      .run(actor.id, member.id, generation).changes > 0;
  })();
}

export function removePartyMember(actor: PartyActor, target: { readonly memberId: string; readonly generation: number }, now = Date.now()): boolean {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null || member.id === target.memberId) { return false; }
    electHost(room, now);
    const current = roomFor(actor.id);
    if (current?.host_member_id !== member.id || current.generation !== target.generation) { return false; }
    return database.query(`UPDATE watch_together_members SET left_at = ?
      WHERE id = ? AND room_id = ? AND left_at IS NULL`).run(now, target.memberId, actor.id).changes === 1;
  })();
}
