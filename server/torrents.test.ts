import { expect, test } from "bun:test";
import { qBittorrentLoginSucceeded } from "./torrents.ts";

test("accepts qBittorrent 4.x and 5.x successful logins", () => {
  expect(qBittorrentLoginSucceeded(200, "Ok.")).toBe(true);
  expect(qBittorrentLoginSucceeded(204, "")).toBe(true);
});

test("rejects qBittorrent login failures", () => {
  expect(qBittorrentLoginSucceeded(200, "Fails.")).toBe(false);
  expect(qBittorrentLoginSucceeded(401, "")).toBe(false);
  expect(qBittorrentLoginSucceeded(403, "Your IP address has been banned")).toBe(false);
  expect(qBittorrentLoginSucceeded(200, "")).toBe(false);
});
