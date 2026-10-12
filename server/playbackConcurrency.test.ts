import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scenarios = ["watched", "progress", "restore"].flatMap((kind) => ["rename", "trash", "reuse", "failures"].map((action) => `${kind}:${action}`));
for (const scenario of scenarios) {
  test(`playback concurrency outcomes: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nanime-playback-concurrency-"));
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "playbackConcurrencyHarness.ts"), directory, scenario], {
        env: { ...Bun.env, NANIME_DATABASE: join(directory, "test.sqlite"),
          NANIME_ADMIN_SETUP_TOKEN: "isolated-playback-concurrency-setup-token",
          MEDIA_DIR: join(directory, "media"), NANIME_MEDIA_DIR: join(directory, "media"),
          QBITTORRENT_URL: "", QBITTORRENT_USERNAME: "", QBITTORRENT_PASSWORD: "" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, output, error }).toEqual({ code: 0, output: "playback concurrency passed\n", error: "" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
}
