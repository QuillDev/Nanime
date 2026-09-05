import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("party refresh, handoff and stale connections keep a single authoritative host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanime-party-members-"));
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", `
        import { expect } from "bun:test";
        import { database } from "./server/database.ts";
        import { createWatchTogether, getWatchTogether } from "./server/watchTogether.ts";
        import { partyPresence, partyPlayback, leaveParty, endParty, removePartyMember } from "./server/watchTogetherMembers.ts";
        import { PARTY_HOST_GRACE } from "./shared/watchTogether.ts";
        import { watchTogetherPartyRoute } from "./server/watchTogetherPartyRoutes.ts";
        import { partyMemberSchema } from "./server/watchTogetherSchemas.ts";
        const creator = database.query("SELECT id FROM users WHERE username = 'admin'").get().id;
        const insert = database.query("INSERT INTO users (username, created_at) VALUES (?, 0)");
        const second = Number(insert.run("guest-one").lastInsertRowid);
        const third = Number(insert.run("guest-two").lastInsertRowid);
        const credentials = n => ({ memberToken: String(n).repeat(43), connectionId: String(n).repeat(36), incarnation: 1 });
        const playback = { position: 10, paused: true, rate: 1, rel: "Example/episode.mp4" };
        const room = createWatchTogether(creator, playback.rel, { ...playback, member: credentials(1) });
        const base = getWatchTogether(room.id).updatedAt;
        const a = { id: room.id, userId: creator, ...credentials(1) };
        const b = { id: room.id, userId: second, ...credentials(2) };
        const c = { id: room.id, userId: third, ...credentials(3) };
        expect(partyPresence(a, base).isHost).toBe(true);
        expect(partyPresence(b, base + 1).isHost).toBe(false);
        expect(partyPresence(c, base + 2).members).toBe(3);
        expect(partyPresence({ ...a, userId: second }, base + 3)).toBeNull();
        const refreshed = { ...a, connectionId: "r".repeat(36), incarnation: 2 };
        const restored = partyPresence(refreshed, base + 100);
        expect(restored.isHost).toBe(true);
        expect(restored.generation).toBe(2);
        expect(restored.members).toBe(3);
        expect(partyPresence(a, base + 101)).toBeNull();
        expect(partyPlayback(a, { ...playback, generation: 1 }, base + 101)).toBeNull();
        expect(leaveParty(a, base + 101)).toBe(false);
        expect(endParty(a, 1, base + 101)).toBe(false);
        expect(partyPlayback(refreshed, { ...playback, generation: restored.generation }, base + 102)).not.toBeNull();
        expect(leaveParty(refreshed, base + 200)).toBe(true);
        const promoted = partyPresence(b, base + 201);
        expect(promoted.isHost).toBe(true);
        expect(promoted.paused).toBe(true);
        expect(promoted.generation).toBe(3);
        expect(partyPresence(c, base + 202).isHost).toBe(false);
        expect(partyPresence(refreshed, base + 203)).toBeNull();
        expect(partyPlayback(refreshed, { ...playback, generation: 2 }, base + 203)).toBeNull();
        expect(endParty(c, promoted.generation, base + 203)).toBe(false);
        expect(partyPlayback(b, { ...playback, position: 20, generation: 3 }, base + 204).position).toBe(20);
        const replacement = createWatchTogether(creator, playback.rel, { ...playback, member: credentials(4) });
        expect(getWatchTogether(room.id)).not.toBeNull();
        partyPresence(c, base + 29000);
        const disconnected = partyPresence(c, base + PARTY_HOST_GRACE + 202);
        expect(disconnected.isHost).toBe(true);
        expect(disconnected.generation).toBe(4);
        expect(partyPlayback(b, { ...playback, generation: 3 }, base + PARTY_HOST_GRACE + 203)).toBeNull();
        expect(partyPresence(b, base + PARTY_HOST_GRACE + 204).isHost).toBe(false);
        expect(endParty(c, 4, base + PARTY_HOST_GRACE + 205)).toBe(true);
        expect(partyPresence(b, base + PARTY_HOST_GRACE + 206)).toBeNull();
        const only = { id: replacement.id, userId: creator, ...credentials(4) };
        expect(leaveParty(only, base + 300)).toBe(true);
        expect(partyPresence(only, base + 301)).toBeNull();
        // Elysia closes the registered member schema; composite requests must
        // still validate against their complete playback/end schemas.
        partyMemberSchema.additionalProperties = false;
        const routed = createWatchTogether(creator, playback.rel, { ...playback, member: credentials(6) });
        const request = (method, body) => ({ user: { id: creator }, req: new Request("http://localhost/api/watch-together", {
          method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        }) });
        const route = action => ({ id: routed.id, action });
        const changed = await watchTogetherPartyRoute(request("PUT", { ...credentials(6), ...playback, generation: 1 }), route("party-playback"), async () => true);
        expect(changed.status).toBe(200);
        const owner = { id: routed.id, userId: creator, ...credentials(6) };
        const visitor = { id: routed.id, userId: second, ...credentials(7) };
        const roster = partyPresence(visitor).memberList;
        const visitorId = roster.find(member => member.isSelf).id;
        const ownerId = roster.find(member => member.isHost).id;
        expect(roster.map(member => member.name).sort()).toEqual(["admin", "guest-one"]);
        expect(removePartyMember(visitor, { memberId: ownerId, generation: 1 })).toBe(false);
        expect(removePartyMember(owner, { memberId: ownerId, generation: 1 })).toBe(false);
        expect(removePartyMember(owner, { memberId: visitorId, generation: 2 })).toBe(false);
        expect(removePartyMember(refreshed, { memberId: visitorId, generation: 2 })).toBe(false);
        const removed = await watchTogetherPartyRoute(request("POST", { ...credentials(6), generation: 1, memberId: visitorId }), route("remove"), async () => true);
        expect(removed.status).toBe(200);
        expect(partyPresence(visitor)).toBeNull();
        expect(partyPresence({ ...visitor, incarnation: 2, connectionId: "z".repeat(36) })).toBeNull();
        expect(partyPresence(owner).memberList.length).toBe(1);
        const ended = await watchTogetherPartyRoute(request("POST", { ...credentials(6), generation: 1 }), route("end"), async () => true);
        expect(ended.status).toBe(200);
        const persisted = createWatchTogether(creator, playback.rel, { ...playback, member: credentials(5) });
        console.log(JSON.stringify({ id: persisted.id, userId: creator, ...credentials(5) }));
      `],
      env: { ...process.env, NANIME_DATABASE: join(directory, "test.sqlite"), NANIME_ADMIN_SETUP_TOKEN: "party-membership-test-setup-token-0001" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(error).toBe("");
    expect(code).toBe(0);
    const restarted = Bun.spawn({
      cmd: [process.execPath, "--eval", `
        import { expect } from "bun:test";
        import { partyPresence } from "./server/watchTogetherMembers.ts";
        const actor = ${output.trim()};
        expect(partyPresence({ ...actor, connectionId: "n".repeat(36), incarnation: 2 }).isHost).toBe(true);
        expect(partyPresence(actor)).toBeNull();
      `],
      env: { ...process.env, NANIME_DATABASE: join(directory, "test.sqlite"), NANIME_ADMIN_SETUP_TOKEN: "party-membership-test-setup-token-0001" },
      stdout: "pipe", stderr: "pipe",
    });
    const [restartCode, restartError] = await Promise.all([restarted.exited, new Response(restarted.stderr).text()]);
    expect(restartError).toBe("");
    expect(restartCode).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
