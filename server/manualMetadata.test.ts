import { expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { manualAniListMetadata } from "./manualMetadata.ts";
import { isolatedEnvironment, runScript, withTemporaryDirectory } from "./testProcess.ts";

test("manual linking preserves fetched details only for the same AniList entry", () => {
  const current = { ...manualAniListMetadata(123, "Example", undefined), episodes: 12, description: "Existing description" };
  expect(manualAniListMetadata(123, "New title", current).episodes).toBe(12);
  expect(manualAniListMetadata(456, "Another show", current).episodes).toBeNull();
});

test("manual mapping works with all upstream requests disabled and records immutable history", async () => {
  await withTemporaryDirectory("nanime-manual-metadata-", async (directory) => {
    const media = join(directory, "media");
    const environment = isolatedEnvironment(directory);
    await mkdir(join(media, "Example Show"), { recursive: true });
    const child = await runScript(`
        import { expect } from "bun:test";
        import { database } from "./server/database.ts";
        import { configureMetadataLibrary, linkAniListResponse, metadataResponse } from "./server/anilist.ts";
        globalThis.fetch = () => { throw new Error("Unexpected network request"); };
        configureMetadataLibrary({ root: ${JSON.stringify(media)}, videoFolders: () => Promise.resolve(["Example Show"]) });
        const actor = database.query("SELECT id, username FROM users WHERE username = 'admin'").get();
        const request = body => new Request("http://localhost/api/anilist/link", { method: "POST", body: JSON.stringify(body) });
        const body = { key: "show:Example Show", id: 123, manualTitle: "Example Show" };
        const response = await linkAniListResponse(request(body), actor);
        expect(response.status).toBe(200);
        const media = await response.json();
        expect(media.anilistId).toBe(123);
        expect(media.episodes).toBeNull();
        expect(media.title.english).toBe("Example Show");
        expect((await (await metadataResponse()).json())[body.key]).toEqual(media);
        expect(database.query("SELECT COUNT(*) AS n FROM library_activity_log").get().n).toBe(1);
        const audit = database.query("SELECT actor_user_id, previous_state FROM library_activity_log").get();
        expect(audit.actor_user_id).toBe(actor.id);
        expect(audit.previous_state).toBeNull();
        expect((await linkAniListResponse(request({ ...body, manualTitle: "   " }), actor)).status).toBe(400);
        expect((await linkAniListResponse(request({ ...body, id: 0 }), actor)).status).toBe(400);
        expect((await linkAniListResponse(request({ ...body, manualTitle: "Updated title" }), actor)).status).toBe(200);
        expect(database.query("SELECT COUNT(*) AS n FROM library_activity_log").get().n).toBe(2);
        expect(() => database.run("DELETE FROM library_activity_log")).toThrow();
      `, environment);
    expect({ code: child.code, error: child.error }).toEqual({ code: 0, error: "" });
    const written = await readFile(join(media, "Example Show", "nanime.json"), "utf8");
    expect(JSON.parse(written)).toEqual({
      version: 1,
      show: { provider: "anilist", id: 123, title: "Updated title" },
    });
  });
});
