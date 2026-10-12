import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("durable recovery excludes source, destination and ancestors from every shared admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanime-recovery-admission-"));
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "libraryRecoveryAdmissionHarness.ts"), directory], {
      env: { ...Bun.env, NANIME_DATABASE: join(directory, "test.sqlite"), NANIME_MEDIA_DIR: join(directory, "media"), NANIME_ADMIN_SETUP_TOKEN: "isolated-recovery-admission-setup-token", QBITTORRENT_URL: "", QBITTORRENT_USERNAME: "", QBITTORRENT_PASSWORD: "" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, output, error }).toEqual({ code: 0, output: "recovery admission passed\n", error: "" });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
