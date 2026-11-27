import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeDuration } from "./mediaInfo.ts";

describe("probeDuration", () => {
  test("does not cache zero duration from a failed probe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nanime-duration-"));
    const video = join(dir, "sample.mp4");
    try {
      expect(await probeDuration(video)).toBe(0);

      const proc = Bun.spawn([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
      ], { stdout: "ignore", stderr: "ignore" });
      expect(await proc.exited).toBe(0);

      const [first, second] = await Promise.all([probeDuration(video), probeDuration(video)]);
      expect(first).toBeGreaterThan(0.5);
      expect(second).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
