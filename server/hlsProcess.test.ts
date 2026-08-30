import { describe, expect, mock, test } from "bun:test";
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
    const wait = mock(() => {
      fake.exit();
      return Promise.resolve();
    });

    await stopHlsProcess(fake.process, 2000, wait);

    expect(fake.signals).toEqual(["SIGTERM"]);
  });

  test("force kills an encoder that ignores the grace period", async () => {
    const fake = fakeProcess();
    const wait = mock(() => Promise.resolve());
    const stopping = stopHlsProcess(fake.process, 2000, wait);
    await wait.mock.results[0]?.value;
    await Promise.resolve();

    expect(fake.signals).toEqual(["SIGTERM", "SIGKILL"]);
    fake.exit(137);
    await stopping;
  });
});
