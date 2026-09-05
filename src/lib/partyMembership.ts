import type { PartyMemberCredentials } from "../../shared/watchTogether.ts";

export interface PartyMembership extends PartyMemberCredentials { readonly id: string }

export function newPartyCredentials(): PartyMemberCredentials {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const memberToken = btoa(String.fromCodePoint(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return { memberToken, connectionId: crypto.randomUUID(), incarnation: 1 };
}
function storageKey(userId: number): string { return `nanime-party:${String(userId)}`; }
export function savePartyMembership(userId: number, membership: PartyMembership | null): void {
  try {
    if (membership === null) { sessionStorage.removeItem(storageKey(userId)); }
    else { sessionStorage.setItem(storageKey(userId), JSON.stringify(membership)); }
  } catch {
    // Browsers that disallow session storage can still join for the current page.
  }
}
function readMembership(userId: number): PartyMembership | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(userId)) ?? "null") as Partial<PartyMembership> | null;
    if (typeof value?.id !== "string" || !/^[\w-]{32}$/u.test(value.id) || typeof value.memberToken !== "string" ||
      !/^[\w-]{43}$/u.test(value.memberToken) || !Number.isSafeInteger(value.incarnation) || (value.incarnation ?? 0) < 1) { return null; }
    return { id: value.id, memberToken: value.memberToken, incarnation: (value.incarnation ?? 1) + 1, connectionId: crypto.randomUUID() };
  } catch { return null; }
}
export function restorePartyMembership(userId: number, invite: string | null): PartyMembership | null {
  const saved = readMembership(userId);
  const membership = invite !== null && invite !== saved?.id ? { id: invite, ...newPartyCredentials() } : saved;
  savePartyMembership(userId, membership);
  return membership;
}
