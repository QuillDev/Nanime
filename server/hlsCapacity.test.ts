import { expect, test } from "bun:test";
import { hlsCapacityAvailable } from "./hlsCapacity.ts";

const AVAILABLE = {
  activeGlobal: 1,
  activeUser: 1,
  maxGlobal: 4,
  maxUser: 2,
  pendingGlobal: 0,
  pendingUser: 0,
};

test("HLS capacity counts active and pending encoders", () => {
  expect(hlsCapacityAvailable(AVAILABLE)).toBe(true);
  expect(hlsCapacityAvailable({ ...AVAILABLE, pendingUser: 1 })).toBe(false);
  expect(hlsCapacityAvailable({ ...AVAILABLE, activeGlobal: 4 })).toBe(false);
  expect(hlsCapacityAvailable({ ...AVAILABLE, activeGlobal: 2, pendingGlobal: 2 }))
    .toBe(false);
});
