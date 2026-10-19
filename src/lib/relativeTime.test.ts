import { describe, expect, test } from "bun:test";
import { relativeTime } from "./relativeTime.ts";

describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 19, 12);
  test("names recent times in their largest whole unit", () => {
    expect(relativeTime(now - 20_000, now)).toBe("just now");
    expect(relativeTime(now - 12 * 60_000, now)).toContain("12");
    expect(relativeTime(now - 86_400_000, now)).toBe(new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-1, "day"));
  });
});
