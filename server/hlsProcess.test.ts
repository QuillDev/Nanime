import { describe, expect, test } from "bun:test";
import { stopHlsProcess, type HlsProcess } from "./hlsProcess.ts";

function fakeProcess() {
  const result = Promise.withResolvers<number>();
  let exitCode: number | null = null;
  const signals: (NodeJS.Signals | number | undefined)[] = [];
  const process: HlsProcess = {
    get exitCode() { return exitCode; },
    exited: result.promise,
    kill(signal) { signals.push(signal); },
  };
  return {
    process,
    signals,
    exit(code = 0) {
      exitCode = code;
      result.resolve(code);
    },
  };
}

describe("HLS encoder shutdown", () => {
  test("allows a graceful exit without force killing", async () => {
    const fake = fakeProcess();
    const wait = (): Promise<void> => {
      fake.exit();
      return Promise.resolve();
    };

    await stopHlsProcess(fake.process, 2000, wait);

    expect(fake.signals).toEqual(["SIGTERM"]);
  });

  test("force kills an encoder that ignores the grace period", async () => {
    const fake = fakeProcess();
    const graceElapsed = Promise.withResolvers<void>();
    const wait = (): Promise<void> => {
      graceElapsed.resolve();
      return Promise.resolve();
    };
    const stopping = stopHlsProcess(fake.process, 2000, wait);
    await graceElapsed.promise;
    await Promise.resolve();

    expect(fake.signals).toEqual(["SIGTERM", "SIGKILL"]);
    fake.exit(137);
    await stopping;
  });
});
