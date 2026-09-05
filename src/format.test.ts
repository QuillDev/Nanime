import { describe, expect, test } from "bun:test";
import { formatCompactCount } from "./format.ts";

describe("compact counts", () => {
  test("keeps ordinary counts exact", () => {
    expect(formatCompactCount(20)).toBe("20");
    expect(formatCompactCount(100)).toBe("100");
    expect(formatCompactCount(999)).toBe("999");
  });

  test("abbreviates thousands with a useful decimal", () => {
    expect(formatCompactCount(1000)).toBe("1k");
    expect(formatCompactCount(1100)).toBe("1.1k");
    expect(formatCompactCount(20_000)).toBe("20k");
  });

  test("promotes rounded values into the next unit", () => {
    expect(formatCompactCount(999_999)).toBe("1m");
    expect(formatCompactCount(1_100_000)).toBe("1.1m");
    expect(formatCompactCount(1_000_000_000)).toBe("1b");
  });

  test("normalizes values that cannot represent a count", () => {
    expect(formatCompactCount(-12)).toBe("0");
    expect(formatCompactCount(Number.NaN)).toBe("0");
  });
});
