import { describe, expect, test } from "bun:test";
import { runInOfflineMediaPool } from "./pool.ts";

interface OccupiedPool {
  readonly release: () => void;
  readonly running: readonly Promise<void>[];
  readonly started: number;
}

function occupyEveryWorker(): OccupiedPool {
  const gate = Promise.withResolvers<void>();
  let started = 0;
  const running = Array.from({ length: 8 }, () => {
    const controller = new AbortController();
    return runInOfflineMediaPool(() => {
      started += 1;
      return gate.promise;
    }, controller.signal);
  });
  return { release: gate.resolve, running, started };
}

describe("global offline request pool", () => {
  test("rejects a canceled queued request without waiting for an occupied slot", async () => {
    const occupied = occupyEveryWorker();
    const controller = new AbortController();
    const queued = runInOfflineMediaPool(() => Promise.resolve(), controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(occupied.started).toBe(8);
    occupied.release();
    await Promise.all(occupied.running);
  });
});
