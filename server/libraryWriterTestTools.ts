import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { setImmediate } from "node:timers";
import { join } from "node:path";

export async function makeWriterVideo(path: string, audio = false): Promise<void> {
  const inputs = audio ? ["-f", "lavfi", "-i", "sine=frequency=440", "-f", "lavfi", "-i", "sine=frequency=880", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:a", "aac"] : [];
  const child = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=size=32x32:rate=2", ...inputs, "-t", "1", "-c:v", "libx264", path], { stdout: "ignore", stderr: "pipe" });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  assert.equal(code, 0, error);
}

/** Install before starting Bun, which caches executable search paths. */
export async function installWriterTools(directory: string): Promise<string> {
  const bin = join(directory, "bin");
  await mkdir(bin);
  for (const name of ["ffprobe", "ffmpeg"]) {
    const executable = Bun.which(name);
    assert.ok(executable, `${name} must be available`);
    const script = join(bin, `${name}.ts`);
    const control = join(directory, "control.json");
    await writeFile(script, `const control = await Bun.file(${JSON.stringify(control)}).json().catch(() => null);\nif (control !== null) await fetch(control.origin + "/${name}");\nconst child = Bun.spawn([${JSON.stringify(executable)}, ...process.argv.slice(2)], {stdout: "inherit", stderr: "inherit"});\nprocess.exit(await child.exited);\n`);
    const launcher = join(bin, name);
    await writeFile(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`);
    await chmod(launcher, 0o700);
  }
  return `${bin}:${process.env["PATH"] ?? ""}`;
}

/** Real external binaries, with HTTP barriers before they execute. */
export async function controlledWriterTools(directory: string) {
  const probeGate = Promise.withResolvers<void>();
  const encoderGate = Promise.withResolvers<void>();
  const probeStarted = Promise.withResolvers<void>();
  const encoderStarted = Promise.withResolvers<void>();
  let probeReleased = false;
  let encoderReleased = false;
  const control = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (new URL(req.url).pathname === "/ffprobe") {
      probeStarted.resolve();
      if (!probeReleased) { await probeGate.promise; }
    } else {
      encoderStarted.resolve();
      if (!encoderReleased) { await encoderGate.promise; }
    }
    return new Response("continue");
  } });
  const configuration = join(directory, "control.json");
  await writeFile(configuration, JSON.stringify({ origin: `http://127.0.0.1:${control.port}` }));
  return {
    probeStarted: probeStarted.promise,
    encoderStarted: encoderStarted.promise,
    releaseProbe() { probeReleased = true; probeGate.resolve(); },
    releaseEncoder() { encoderReleased = true; encoderGate.resolve(); },
    close() { probeGate.resolve(); encoderGate.resolve(); control.stop(true); rmSync(configuration, { force: true }); },
  };
}

/** Yield to real process/SQLite completion, not a timing-based race delay. */
export function waitForWriterOutcome(done: () => boolean): Promise<void> {
  const deadline = performance.now() + 10_000;
  const outcome = Promise.withResolvers<void>();
  const check = (): void => {
    try {
      if (done()) {
        outcome.resolve();
      } else {
        assert.ok(performance.now() < deadline, "writer did not reach its expected durable outcome");
        setImmediate(check);
      }
    } catch (error) {
      outcome.reject(error);
    }
  };
  check();
  return outcome.promise;
}
