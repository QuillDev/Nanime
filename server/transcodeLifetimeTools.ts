import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Real tools installed before isolated Bun starts; SIGTERM exit can be held. */
export async function installTranscodeLifetimeTools(directory: string): Promise<string> {
  const bin = join(directory, "bin"); await mkdir(bin);
  for (const name of ["ffmpeg", "ffprobe"]) {
    const executable = Bun.which(name); assert.ok(executable);
    const script = join(bin, `${name}.ts`);
    await writeFile(script, `const config = await Bun.file(${JSON.stringify(join(directory, "control.json"))}).json().catch(() => null);
let cancelled = false;
let child: ReturnType<typeof Bun.spawn> | null = null;
process.on("SIGTERM", () => { cancelled = true; void (async () => {
  if (config !== null) await fetch(config.origin + "/cancel-exit");
  child?.kill(); if (child !== null) await child.exited; process.exit(143);
})(); });
if (config !== null) {
 const stage = ${JSON.stringify(name)} === "ffprobe" && process.argv.at(-1)?.includes(".nanime-transcodes") ? "validation" : ${JSON.stringify(name)};
 await fetch(config.origin + "/" + stage);
 if (config.failProgress === true && ${JSON.stringify(name)} === "ffmpeg") {
  await Bun.write(Bun.stdout, "out_time_us=500000\\nspeed=1x\\nprogress=continue\\n");
  await fetch(config.origin + "/progress-ready");
 }
}
if (!cancelled) {
 child = Bun.spawn([${JSON.stringify(executable)}, ...process.argv.slice(2)], { stdout: "inherit", stderr: "inherit" });
 const code = await child.exited; if (!cancelled) process.exit(code);
}
await new Promise(() => {});
`);
    const launcher = join(bin, name);
    await writeFile(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`);
    await chmod(launcher, 0o700);
  }
  return `${bin}:${process.env["PATH"] ?? ""}`;
}
