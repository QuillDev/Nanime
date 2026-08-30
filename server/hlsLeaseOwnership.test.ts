import { expect, test } from "bun:test";
import { supersedeHlsLease } from "./hlsLeaseOwnership.ts";

test("a delayed stale replacement cannot reclaim ownership from the newest lease", async () => {
  const owners = new Map([["player", "A"]]);
  const releaseA = Promise.withResolvers<void>();
  const replacingWithB = supersedeHlsLease({
    owners, owner: "player", leaseId: "B", release: async (previous) => {
      expect(previous).toBe("A");
      await releaseA.promise;
    },
  });
  expect(owners.get("player")).toBe("B");
  expect(await supersedeHlsLease({
    owners, owner: "player", leaseId: "C", release: () => Promise.resolve(),
  })).toBe(true);
  releaseA.resolve();
  expect(await replacingWithB).toBe(false);
  expect(owners.get("player")).toBe("C");
});
