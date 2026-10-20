import { expect, test } from "bun:test";
import { manualAniListMetadata } from "./manualMetadata.ts";

test("manual linking preserves fetched details only for the same AniList entry", () => {
  const current = { ...manualAniListMetadata(123, "Example", undefined), episodes: 12, description: "Existing description" };
  expect(manualAniListMetadata(123, "New title", current).episodes).toBe(12);
  expect(manualAniListMetadata(456, "Another show", current).episodes).toBeNull();
});
