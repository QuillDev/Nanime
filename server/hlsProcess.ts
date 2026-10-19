export interface HlsProcess {
  readonly exitCode: number | null;
  readonly exited: Promise<number>;
  readonly kill: (signal?: NodeJS.Signals | number) => void;
}

/** What an HLS session runs: one ffmpeg process, or a passthrough producer that manages several. */
export interface HlsProducer extends HlsProcess {
  readonly stderr: ReadableStream<Uint8Array>;
  /** Episode time of the playlist's local zero when it isn't the requested segment boundary. */
  readonly start?: number;
  /** Producers that repackage on demand resolve (and wait for) segment files themselves. */
  readonly segmentPath?: (name: string) => Promise<string | null>;
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
