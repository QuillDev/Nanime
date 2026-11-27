import { expect, test } from "bun:test";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isolatedEnvironment, runScript, withTemporaryDirectory } from "./testProcess.ts";

const H264_PROBE_LINE = String.raw`printf '%s\n' '{"streams":[{"codec_name":"h264","pix_fmt":"yuv420p"}],"format":{"tags":{}}}'`;

async function writeProbeShim(directory: string, script: string): Promise<string> {
  const bin = join(directory, "bin");
  await mkdir(bin, { recursive: true });
  const shim = join(bin, "ffprobe");
  await Bun.write(shim, script);
  await chmod(shim, 0o755);
  return bin;
}

test("caches failed probes for the negative TTL and recovers after it expires", async () => {
  await withTemporaryDirectory("nanime-readiness-ttl-", async (directory) => {
    const media = join(directory, "media");
    const marker = join(directory, "fail-once");
    const calls = join(directory, "calls.log");
    await mkdir(media, { recursive: true });
    await Promise.all([
      Bun.write(join(media, "episode.mkv"), "stub"),
      Bun.write(marker, "1"),
    ]);
    const bin = await writeProbeShim(directory, [
      "#!/usr/bin/env sh",
      `echo call >> ${JSON.stringify(calls)}`,
      `if [ -f ${JSON.stringify(marker)} ]; then rm -f ${JSON.stringify(marker)}; exit 1; fi`,
      H264_PROBE_LINE,
    ].join("\n"));

    const script = `
      import { join } from "node:path";
      import { playbackPlan } from "./server/playbackReadiness.ts";
      const media = ${JSON.stringify(media)};
      const options = {
        mediaDir: media,
        mediaRoot: media,
        videoExtensions: new Set([".mkv"]),
        directPlayExtensions: new Set(),
        hardwareAcceleration: "",
      };
      const file = join(media, "episode.mkv");
      const first = await playbackPlan(file, "episode.mkv", options);
      const cached = await playbackPlan(file, "episode.mkv", options);
      await Bun.sleep(160);
      const retried = await playbackPlan(file, "episode.mkv", options);
      console.log(JSON.stringify({ first: first.kind, cached: cached.kind, retried: retried.kind }));
    `;
    const env = isolatedEnvironment(directory, {
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      NANIME_PROBE_FAILURE_TTL_MS: "120",
    });
    const result = await runScript(script, env);
    expect({ code: result.code, error: result.error }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(result.output.trim())).toEqual({
      first: "transcode-required",
      cached: "transcode-required",
      retried: "stream",
    });

    const callLog = await Bun.file(calls).text();
    const callCount = callLog.trim().split("\n").filter((line) => line !== "").length;
    expect(callCount).toBe(2);
  });
}, 30_000);

test("caps concurrent ffprobe processes during a cold readiness batch", async () => {
  await withTemporaryDirectory("nanime-readiness-concurrency-", async (directory) => {
    const media = join(directory, "media");
    const active = join(directory, "active");
    const log = join(directory, "concurrency.log");
    await mkdir(media, { recursive: true });
    await mkdir(active, { recursive: true });
    const paths = Array.from({ length: 10 }, (_, index) => `episode-${String(index)}.mkv`);
    await Promise.all(paths.map((name) => Bun.write(join(media, name), "stub")));
    const bin = await writeProbeShim(directory, [
      "#!/usr/bin/env sh",
      `slot=${JSON.stringify(active)}/$$`,
      ': > "$slot"',
      `ls ${JSON.stringify(active)} | wc -l >> ${JSON.stringify(log)}`,
      "sleep 0.08",
      'rm -f "$slot"',
      H264_PROBE_LINE,
    ].join("\n"));

    const script = `
      import { join } from "node:path";
      import { playbackReadinessResponse } from "./server/playbackReadiness.ts";
      const media = ${JSON.stringify(media)};
      const paths = ${JSON.stringify(paths)};
      const options = {
        mediaDir: media,
        mediaRoot: media,
        videoExtensions: new Set([".mkv"]),
        directPlayExtensions: new Set(),
        hardwareAcceleration: "",
      };
      const req = new Request("http://localhost/api/playback-readiness", {
        method: "POST",
        body: JSON.stringify({ paths }),
      });
      const response = await playbackReadinessResponse(req, (rel) => Promise.resolve(join(media, rel)), options);
      const body = await response.json();
      console.log(JSON.stringify({ status: response.status, readyCount: body.items.filter((item) => item.ready).length }));
    `;
    const env = isolatedEnvironment(directory, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });
    const result = await runScript(script, env);
    expect({ code: result.code, error: result.error }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(result.output.trim())).toEqual({ status: 200, readyCount: paths.length });

    const logText = await Bun.file(log).text();
    const counts = logText.trim().split("\n").map((line) => Number(line.trim()));
    expect(counts.length).toBe(paths.length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
  });
}, 30_000);

test("prioritizes interactive playback probes ahead of queued batch readiness probes", async () => {
  await withTemporaryDirectory("nanime-readiness-priority-", async (directory) => {
    const media = join(directory, "media");
    const order = join(directory, "order.log");
    await mkdir(media, { recursive: true });
    const batchPaths = Array.from({ length: 16 }, (_, index) => `batch-${String(index)}.mkv`);
    await Promise.all([
      ...batchPaths.map((name) => Bun.write(join(media, name), "stub")),
      Bun.write(join(media, "interactive.mkv"), "stub"),
    ]);
    const bin = await writeProbeShim(directory, [
      "#!/usr/bin/env sh",
      'target=""',
      'for arg in "$@"; do target="$arg"; done',
      `basename "$target" >> ${JSON.stringify(order)}`,
      "sleep 0.1",
      H264_PROBE_LINE,
    ].join("\n"));

    const script = `
      import { join } from "node:path";
      import { playbackPlan, playbackReadinessResponse } from "./server/playbackReadiness.ts";
      const media = ${JSON.stringify(media)};
      const batchPaths = ${JSON.stringify(batchPaths)};
      const options = {
        mediaDir: media,
        mediaRoot: media,
        videoExtensions: new Set([".mkv"]),
        directPlayExtensions: new Set(),
        hardwareAcceleration: "",
      };
      const req = new Request("http://localhost/api/playback-readiness", {
        method: "POST",
        body: JSON.stringify({ paths: batchPaths }),
      });
      const batch = playbackReadinessResponse(req, (rel) => Promise.resolve(join(media, rel)), options);
      await Bun.sleep(25);
      const interactive = await playbackPlan(join(media, "interactive.mkv"), "interactive.mkv", options);
      await batch;
      console.log(JSON.stringify({ interactive: interactive.kind }));
    `;
    const env = isolatedEnvironment(directory, { PATH: `${bin}:${process.env["PATH"] ?? ""}` });
    const result = await runScript(script, env);
    expect({ code: result.code, error: result.error }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(result.output.trim())).toEqual({ interactive: "stream" });

    const orderText = await Bun.file(order).text();
    const started = orderText.trim().split("\n");
    const interactivePosition = started.indexOf("interactive.mkv");
    // Wave 1 (0..3) fills all four slots; interactive runs in wave 2 (4..7) instead of waiting behind all 16 batch items.
    expect(interactivePosition).toBeGreaterThanOrEqual(0);
    expect(interactivePosition).toBeLessThanOrEqual(7);
  });
}, 30_000);

test("kills a hung ffprobe after the timeout and frees its slot for later probes", async () => {
  await withTemporaryDirectory("nanime-readiness-timeout-", async (directory) => {
    const media = join(directory, "media");
    await mkdir(media, { recursive: true });
    const hungPaths = Array.from({ length: 4 }, (_, index) => `hung-${String(index)}.mkv`);
    await Promise.all([
      ...hungPaths.map((name) => Bun.write(join(media, name), "stub")),
      Bun.write(join(media, "healthy.mkv"), "stub"),
    ]);
    const bin = await writeProbeShim(directory, [
      "#!/usr/bin/env sh",
      'target=""',
      'for arg in "$@"; do target="$arg"; done',
      'case "$target" in *hung-*) exec sleep 10 ;; esac',
      H264_PROBE_LINE,
    ].join("\n"));

    const script = `
      import { join } from "node:path";
      import { playbackPlan } from "./server/playbackReadiness.ts";
      const media = ${JSON.stringify(media)};
      const hungPaths = ${JSON.stringify(hungPaths)};
      const options = {
        mediaDir: media,
        mediaRoot: media,
        videoExtensions: new Set([".mkv"]),
        directPlayExtensions: new Set(),
        hardwareAcceleration: "",
      };
      const hung = Promise.all(hungPaths.map((rel) => playbackPlan(join(media, rel), rel, options)));
      await Bun.sleep(20);
      const healthy = await playbackPlan(join(media, "healthy.mkv"), "healthy.mkv", options);
      const hungPlans = await hung;
      console.log(JSON.stringify({
        hungKinds: hungPlans.map((plan) => plan.kind),
        healthyKind: healthy.kind,
      }));
    `;
    const env = isolatedEnvironment(directory, {
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      NANIME_PROBE_TIMEOUT_MS: "150",
    });
    const result = await runScript(script, env);
    expect({ code: result.code, error: result.error }).toEqual({ code: 0, error: "" });
    expect(JSON.parse(result.output.trim())).toEqual({
      hungKinds: ["transcode-required", "transcode-required", "transcode-required", "transcode-required"],
      healthyKind: "stream",
    });
  });
}, 30_000);
