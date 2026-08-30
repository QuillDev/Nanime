import { expect, test } from "bun:test";
import {
  hlsCapacityAvailable,
  oldestLegacyHlsSession,
  reserveHlsPlaybackCapacity,
} from "./hlsCapacity.ts";

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

test("legacy HLS capacity reclaims the oldest session for only that user", () => {
  const sessions = [
    { id: "managed", lastAccess: 1, legacyAccess: false, userId: 7 },
    { id: "other-user", lastAccess: 2, legacyAccess: true, userId: 8 },
    { id: "newer", lastAccess: 4, legacyAccess: true, userId: 7 },
    { id: "oldest", lastAccess: 3, legacyAccess: true, userId: 7 },
  ];
  expect(oldestLegacyHlsSession(sessions, 7)?.id).toBe("oldest");
});

test("managed playback waits for every stopping encoder needed to free capacity", async () => {
  let attempts = 0;
  let stops = 2;
  const reserved = await reserveHlsPlaybackCapacity({
    managed: true,
    reclaim: () => Promise.resolve(),
    sessions: () => [],
    tryReserve: () => ++attempts === 3,
    userId: 7,
    waitForStopping: () => Promise.resolve(stops-- > 0),
  });
  expect(reserved).toBe(true);
  expect(attempts).toBe(3);
});

test("legacy playback evicts an old session before rejecting a seek", async () => {
  const sessions = [{ lastAccess: 1, legacyAccess: true, userId: 7 }];
  let available = false;
  const reserved = await reserveHlsPlaybackCapacity({
    managed: false,
    reclaim: (session) => {
      sessions.splice(sessions.indexOf(session), 1);
      available = true;
      return Promise.resolve();
    },
    sessions: () => sessions,
    tryReserve: () => available,
    userId: 7,
    waitForStopping: () => Promise.resolve(false),
  });
  expect(reserved).toBe(true);
  expect(sessions).toHaveLength(0);
});
