import { api, unwrap } from "./api.ts";
import type { AuthUser } from "./types.ts";

/** Signing a TV in from a phone; the server side is server/deviceLogins.ts. */
export interface DeviceLoginCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresAt: number;
  readonly interval: number;
}

export interface DeviceLoginPoll {
  readonly status: "pending" | "approved" | "expired";
  readonly user?: AuthUser | undefined;
}

export interface DeviceLoginRequest {
  readonly userCode: string;
  readonly device: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export async function startDeviceLogin(): Promise<DeviceLoginCode> {
  return unwrap(await api.api.auth.device.post(), "Sign-in code");
}

export async function pollDeviceLogin(deviceCode: string, signal: AbortSignal): Promise<DeviceLoginPoll> {
  return unwrap(await api.api.auth.device.poll.post({ deviceCode }, { fetch: { signal } }), "Sign-in check");
}

export async function fetchDeviceLogin(userCode: string, signal: AbortSignal): Promise<DeviceLoginRequest> {
  return unwrap(await api.api.auth.device({ code: userCode }).get({ fetch: { signal } }), "Sign-in code");
}

export async function approveDeviceLogin(userCode: string): Promise<void> {
  unwrap(await api.api.auth.device.approve.post({ userCode }), "Sign-in approval");
}

/** `ABCD-EFGH`: easier to read off a TV and to type. */
export function formatUserCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The phone page a TV's QR code opens. */
export function deviceLinkUrl(userCode: string, origin = globalThis.location.origin): string {
  return `${origin}/link?code=${userCode}`;
}
