export interface HlsProcess {
  readonly exitCode: number | null;
  readonly exited: Promise<number>;
  readonly kill: (signal?: NodeJS.Signals | number) => void;
}

type GraceWait = (milliseconds: number) => Promise<void>;

export async function stopHlsProcess(
  process: HlsProcess,
  graceMilliseconds: number,
  wait: GraceWait = Bun.sleep,
): Promise<void> {
  if (process.exitCode === null) {
    process.kill("SIGTERM");
    await Promise.race([process.exited.catch(() => -1), wait(graceMilliseconds)]);
  }
  if (process.exitCode === null) {
    process.kill("SIGKILL");
  }
  await process.exited.catch(() => -1);
}
