interface ProcessHandle {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly kill: () => void;
}

/** A reader or persistence failure must not let the worker's source lease end
 * while its child is still alive. Keep every reader observed through child exit. */
async function stopAndDrain(process: ProcessHandle, readers: readonly Promise<unknown>[]): Promise<void> {
  try {
    if (process.exitCode === null) { process.kill(); }
  } finally {
    await Promise.allSettled([process.exited, ...readers]);
  }
}

export async function captureProbe(process: ProcessHandle, text: Promise<string>): Promise<{ code: number; text: string }> {
  try {
    const [code, output] = await Promise.all([process.exited, text]);
    return { code, text: output };
  } catch (error) {
    await stopAndDrain(process, [text]);
    throw error;
  }
}

export async function captureEncoder(process: ProcessHandle, readers: { readonly stderr: Promise<string>; readonly progress: Promise<void> }): Promise<{ code: number; stderr: string }> {
  try {
    const [code, stderr] = await Promise.all([process.exited, readers.stderr, readers.progress]);
    return { code, stderr };
  } catch (error) {
    await stopAndDrain(process, [readers.stderr, readers.progress]);
    throw error;
  }
}
