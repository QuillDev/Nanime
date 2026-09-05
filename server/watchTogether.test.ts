import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("watch together validates invitations, ownership, expiration and durable storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanime-watch-together-"));
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "--eval", `
        import { expect } from "bun:test";
        import { database } from "./server/database.ts";
        import { createWatchTogether, getWatchTogether, updateWatchTogether, endWatchTogether } from "./server/watchTogether.ts";
        import { watchTogetherRoute } from "./server/watchTogetherRoutes.ts";
        const userId = database.query("SELECT id FROM users WHERE username = 'admin'").get().id;
        const playback = { position: 35, paused: false, rate: 1 };
        const room = createWatchTogether(userId, "Example/episode.mp4", playback);
        const state = getWatchTogether(room.id);
        expect(state.position).toBe(35);
        expect(state).not.toHaveProperty("hostToken");
        expect(updateWatchTogether({ ...room, userId: userId + 1, playback })).toBe(false);
        expect(updateWatchTogether({ ...room, hostToken: "wrong", userId, playback })).toBe(false);
        expect(updateWatchTogether({ ...room, userId, playback: { ...playback, position: 50, paused: true } })).toBe(true);
        expect(getWatchTogether(room.id).paused).toBe(true);
        expect(updateWatchTogether({ ...room, userId, playback: { ...playback, rel: "Other Show/episode-2.mp4", position: 0 } })).toBe(true);
        expect(getWatchTogether(room.id).rel).toBe("Other Show/episode-2.mp4");
        expect(updateWatchTogether({ ...room, userId, playback: { ...playback, rel: null, paused: true } })).toBe(true);
        expect(getWatchTogether(room.id).rel).toBeNull();
        expect(updateWatchTogether({ ...room, userId, playback: { ...playback, rel: "Example/episode.mp4" } })).toBe(true);
        expect(endWatchTogether(room.id, userId + 1, room.hostToken)).toBe(false);
        expect(getWatchTogether(room.id, state.updatedAt + 16000)).toBeNull();
        expect(updateWatchTogether({ ...room, userId, playback }, state.updatedAt + 16000)).toBe(false);
        const replacement = createWatchTogether(userId, "Example/episode.mp4", playback);
        expect(getWatchTogether(room.id)).toBeNull();
        const context = { pathname: "/api/watch-together", user: { id: userId } };
        const request = body => new Request("http://localhost/api/watch-together", { method: "POST", body: JSON.stringify(body) });
        expect((await watchTogetherRoute({ ...context, req: request({ ...playback, rel: "missing" }) }, async () => false)).status).toBe(404);
        expect((await watchTogetherRoute({ ...context, req: request({ ...playback, rel: "Example/episode.mp4", position: -1 }) }, async () => true)).status).toBe(400);
        const updateContext = { pathname: "/api/watch-together/" + replacement.id, user: { id: userId } };
        const updateRequest = body => new Request("http://localhost" + updateContext.pathname, { method: "PUT", body: JSON.stringify(body) });
        expect((await watchTogetherRoute({ ...updateContext, req: updateRequest({ ...playback, hostToken: replacement.hostToken, rel: "missing.mp4" }) }, async () => false)).status).toBe(404);
        expect(getWatchTogether(replacement.id).rel).toBe("Example/episode.mp4");
        expect((await watchTogetherRoute({ ...updateContext, req: updateRequest({ ...playback, hostToken: "x".repeat(43), rel: null }) }, async () => true)).status).toBe(403);
        expect((await watchTogetherRoute({ ...updateContext, req: updateRequest({ ...playback, hostToken: replacement.hostToken, rel: null, paused: true }) }, async () => false)).status).toBe(200);
        expect(getWatchTogether(replacement.id).rel).toBeNull();
        expect(endWatchTogether(replacement.id, userId, replacement.hostToken)).toBe(true);
        expect(getWatchTogether(replacement.id)).toBeNull();
        const finalRoom = createWatchTogether(userId, "Example/persisted.mp4", playback);
        console.log(finalRoom.id);
      `],
      env: { ...process.env, NANIME_DATABASE: join(directory, "test.sqlite"), NANIME_ADMIN_SETUP_TOKEN: "watch-together-test-setup-token-0001" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(error).toBe("");
    expect(code).toBe(0);
    const restart = Bun.spawn({
      cmd: [process.execPath, "--eval", `
        import { expect } from "bun:test";
        import { getWatchTogether } from "./server/watchTogether.ts";
        expect(getWatchTogether(${JSON.stringify(output.trim())}).rel).toBe("Example/persisted.mp4");
      `],
      env: { ...process.env, NANIME_DATABASE: join(directory, "test.sqlite"), NANIME_ADMIN_SETUP_TOKEN: "watch-together-test-setup-token-0001" },
      stdout: "pipe", stderr: "pipe",
    });
    const [restartCode, restartError] = await Promise.all([restart.exited, new Response(restart.stderr).text()]);
    expect(restartError).toBe("");
    expect(restartCode).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
