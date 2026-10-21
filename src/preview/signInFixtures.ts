import type { QueryClient } from "@tanstack/react-query";

export const PREVIEW_DEVICE_CODE = "KD7MWQ4R";

/** The TV's code and the phone's lookup, as if the server had answered. */
export function seedSignIn(client: QueryClient): void {
  const now = Date.now();
  client.setQueryData(["device-login-code"], { deviceCode: "preview", userCode: PREVIEW_DEVICE_CODE, expiresAt: now + 600_000, interval: 2 });
  client.setQueryData(["device-login-request", PREVIEW_DEVICE_CODE], { userCode: PREVIEW_DEVICE_CODE, device: "Android TV", createdAt: now, expiresAt: now + 600_000 });
}
