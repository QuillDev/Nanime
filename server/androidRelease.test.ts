import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { androidReleaseResponse } from "./androidRelease.ts";

const APK_BYTES = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 1, 2, 3, 4]);
const SHA256 = "a".repeat(64);

let releaseDir = "";

beforeEach(async () => {
  releaseDir = await mkdtemp(join(tmpdir(), "nanime-android-release-"));
});

afterEach(async () => {
  await rm(releaseDir, { recursive: true, force: true });
});

async function publish(manifest: unknown, apk: Uint8Array = APK_BYTES): Promise<void> {
  await writeFile(join(releaseDir, "android-release.json"), JSON.stringify(manifest));
  await writeFile(join(releaseDir, "nanime.apk"), apk);
}

function get(path: string): Request {
  return new Request(`https://nanime.invalid${path}`);
}

describe("android release routes", () => {
  test("describes the published release and serves its APK", async () => {
    await publish({ versionCode: 12, versionName: "0.1.12", sha256: SHA256, sizeBytes: APK_BYTES.length });

    const manifest = await androidReleaseResponse("/api/android/release", get("/api/android/release"), releaseDir);
    expect(manifest?.status).toBe(200);
    expect(await manifest?.json()).toEqual({
      versionCode: 12,
      versionName: "0.1.12",
      sha256: SHA256,
      sizeBytes: APK_BYTES.length,
      apkUrl: "/android/nanime.apk",
    });

    const apk = await androidReleaseResponse("/android/nanime.apk", get("/android/nanime.apk"), releaseDir);
    expect(apk?.status).toBe(200);
    expect(apk?.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(new Uint8Array(await apk!.arrayBuffer())).toEqual(APK_BYTES);
  });

  test("reports no release when unconfigured, malformed, or the APK does not match", async () => {
    const unconfigured = await androidReleaseResponse("/api/android/release", get("/api/android/release"), null);
    expect(unconfigured?.status).toBe(404);

    await publish({ versionCode: 0, versionName: "", sha256: "nope", sizeBytes: 8 });
    const malformed = await androidReleaseResponse("/api/android/release", get("/api/android/release"), releaseDir);
    expect(malformed?.status).toBe(404);

    await publish({ versionCode: 3, versionName: "0.1.3", sha256: SHA256, sizeBytes: 999 });
    const truncated = await androidReleaseResponse("/android/nanime.apk", get("/android/nanime.apk"), releaseDir);
    expect(truncated?.status).toBe(404);
  });

  test("ignores unrelated paths and rejects writes", async () => {
    expect(await androidReleaseResponse("/api/list", get("/api/list"), releaseDir)).toBeNull();
    const post = new Request("https://nanime.invalid/api/android/release", { method: "POST" });
    const rejected = await androidReleaseResponse("/api/android/release", post, releaseDir);
    expect(rejected?.status).toBe(405);
  });
});
