import { describe, expect, test } from "bun:test";
import { runInOfflineMediaPool } from "./pool.ts";

interface OccupiedPool {
  readonly release: () => void;
  readonly running: readonly Promise<void>[];
  readonly started: () => number;
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
  return { release: gate.resolve, running, started: () => started };
}

/** Resolves if the queued request is still waiting once every slot has stayed busy. */
async function stillQueuedAfter(milliseconds: number): Promise<string> {
  await Bun.sleep(milliseconds);
  return "still queued behind occupied slots";
}

describe("global offline request pool", () => {
  test("rejects a canceled queued request without waiting for an occupied slot", async () => {
    const occupied = occupyEveryWorker();
    const controller = new AbortController();
    let queuedRan = false;
    const queued = runInOfflineMediaPool(() => {
      queuedRan = true;
      return Promise.resolve();
    }, controller.signal);
    controller.abort();
    // Every slot is still held, so a rejection that waits for one never arrives.
    await expect(Promise.race([queued, stillQueuedAfter(1000)])).rejects.toMatchObject({ name: "AbortError" });
    expect(occupied.started()).toBe(8);
    occupied.release();
    await Promise.all(occupied.running);
    expect(queuedRan).toBe(false);
  });
});
