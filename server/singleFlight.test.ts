import { expect, test } from "bun:test";
import { SingleFlight } from "./singleFlight.ts";

test("shares concurrent work for the same key and permits later work", async () => {
  const requests = new SingleFlight<string, number>();
  let calls = 0;
  const create = async (): Promise<number> => {
    calls += 1;
    await Bun.sleep(5);
    return calls;
  };

  expect(await Promise.all([
    requests.run("episode", create),
    requests.run("episode", create),
    requests.run("episode", create),
  ])).toEqual([1, 1, 1]);
  expect(calls).toBe(1);
  expect(await requests.run("episode", create)).toBe(2);
});
