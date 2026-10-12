import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTranscodeLifetimeTools } from "./transcodeLifetimeTools.ts";

for (const scenario of ["resolve", "output", "probe", "processing-exit", "cleanup", "validation", "queued-unstarted", "failed-admission", "handoff", "handoff-bulk", "queued-delete", "progress-failure"]) {
  test(`transcode cancellation retains source until worker settles: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nanime-transcode-lifetime-"));
    let child: ReturnType<typeof Bun.spawn> | undefined = undefined;
    try {
      const path = await installTranscodeLifetimeTools(directory);
      const running = Bun.spawn([process.execPath, join(import.meta.dir, "transcodeLifetimeHarness.ts"), directory, scenario], {
        env: { ...Bun.env, PATH: path, NANIME_TRANSCODE_WORKERS: "1", NANIME_DATABASE: join(directory, "test.sqlite"), NANIME_MEDIA_DIR: join(directory, "media"), NANIME_ADMIN_SETUP_TOKEN: "isolated-transcode-lifetime-setup-token", QBITTORRENT_URL: "", QBITTORRENT_USERNAME: "", QBITTORRENT_PASSWORD: "" },
        stdout: "pipe", stderr: "pipe",
      });
      child = running;
      const [code, output, error] = await Promise.all([running.exited, new Response(running.stdout).text(), new Response(running.stderr).text()]);
      expect({ code, output, error }).toEqual({ code: 0, output: "transcode lifetime passed\n", error: "" });
    } finally { child?.kill(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
}
