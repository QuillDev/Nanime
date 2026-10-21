import { join } from "node:path";

/**
 * Self-hosted Android app updates. CI publishes a signed APK plus
 * `android-release.json`; the operator copies both into
 * `NANIME_ANDROID_RELEASE_DIR`. Signed-in clients poll the manifest and
 * download the APK with their normal session, so a private repository never
 * needs to hand tokens to phones.
 */

export const ANDROID_RELEASE_MANIFEST = "android-release.json";
export const ANDROID_RELEASE_APK = "nanime.apk";
export const ANDROID_APK_PATH = "/android/nanime.apk";

export interface AndroidRelease {
  readonly versionCode: number;
  readonly versionName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly apkUrl: string;
}

interface ManifestFields {
  readonly versionCode?: unknown;
  readonly versionName?: unknown;
  readonly sha256?: unknown;
  readonly sizeBytes?: unknown;
}

function parsedRelease(value: unknown): AndroidRelease | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { versionCode, versionName, sha256, sizeBytes } = value as ManifestFields;
  const valid = Number.isSafeInteger(versionCode) && (versionCode as number) > 0 &&
    typeof versionName === "string" && versionName !== "" &&
    typeof sha256 === "string" && /^[0-9a-f]{64}$/u.test(sha256) &&
    Number.isSafeInteger(sizeBytes) && (sizeBytes as number) > 0;
  return valid
    ? {
      versionCode: versionCode as number,
      versionName: versionName as string,
      sha256: sha256 as string,
      sizeBytes: sizeBytes as number,
      apkUrl: ANDROID_APK_PATH,
    }
    : null;
}

async function publishedRelease(releaseDir: string): Promise<AndroidRelease | null> {
  const manifest = Bun.file(join(releaseDir, ANDROID_RELEASE_MANIFEST));
  const apk = Bun.file(join(releaseDir, ANDROID_RELEASE_APK));
  const [parsed, apkExists] = await Promise.all([
    manifest.json().catch(() => null) as Promise<unknown>,
    apk.exists(),
  ]);
  const release = parsedRelease(parsed);
  return release !== null && apkExists && apk.size === release.sizeBytes ? release : null;
}

/** Handles the Android update routes for an authenticated user; null for other paths. */
export async function androidReleaseResponse(
  pathname: string,
  req: Request,
  releaseDir: string | null,
): Promise<Response | null> {
  const manifestRoute = pathname === "/api/android/release";
  if (!manifestRoute && pathname !== ANDROID_APK_PATH) {
    return null;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const release = releaseDir === null ? null : await publishedRelease(releaseDir);
  if (release === null || releaseDir === null) {
    return new Response("No Android release is published", { status: 404 });
  }
  if (manifestRoute) {
    return Response.json(release, { headers: { "cache-control": "no-store" } });
  }
  return new Response(Bun.file(join(releaseDir, ANDROID_RELEASE_APK)), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="nanime-${String(release.versionCode)}.apk"`,
      "content-type": "application/vnd.android.package-archive",
    },
  });
}
