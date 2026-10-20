import { expect, test } from "bun:test";
import { stopHlsProcess } from "./hlsProcess.ts";

/** A real long-running process; `ignoreTerm` makes it shrug off SIGTERM like a wedged encoder. */
function encoder(ignoreTerm: boolean): ReturnType<typeof Bun.spawn> {
  const script = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""} setInterval(() => {}, 1000); console.log("ready");`;
  return Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "ignore" });
}

async function started(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  reader.releaseLock();
}

test("an encoder that honours SIGTERM stops gracefully, without being force killed", async () => {
  const child = encoder(false);
  await started(child);

  await stopHlsProcess(child, 5000);

  expect(child.signalCode).toBe("SIGTERM");
});

test("an encoder that ignores SIGTERM is force killed once the grace period ends", async () => {
  const child = encoder(true);
  await started(child);
  const begun = Date.now();

  await stopHlsProcess(child, 200);

  expect(child.signalCode).toBe("SIGKILL");
  expect(Date.now() - begun).toBeLessThan(3000);
});
