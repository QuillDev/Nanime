import { expect, test } from "bun:test";
import { updatePlaybackProgress } from "./playback.ts";
import { playbackProgressForUser } from "./playbackAudit.ts";
import { retainTorrentOwnership } from "./libraryWriters.ts";

const folder = "Seeding show (Season 01)";
const rel = `${folder}/episode-01.mkv`;
const options = { mediaExists: () => Promise.resolve(true) };

test("progress saves for an episode whose torrent is still seeding", async () => {
  const release = retainTorrentOwnership([folder]);
  try {
    const response = await updatePlaybackProgress(new Request("http://nanime.test/api/progress", {
      method: "PUT",
      body: JSON.stringify({ rel, position: 300, duration: 1440, completed: false }),
    }), { id: 1, username: "admin" }, options);

    expect(response.status).toBe(200);
    expect(playbackProgressForUser(1).find((entry) => entry.rel === rel)?.position).toBe(300);
  } finally {
    release();
  }
});
