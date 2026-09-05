export function partyInviteLink(id: string): string {
  const url = new URL("/", globalThis.location.origin);
  url.searchParams.set("watch", id);
  return url.href;
}

export function partyIdFromInvite(value: string, origin: string): string | null {
  try {
    const url = new URL(value.trim(), origin);
    const id = url.searchParams.get("watch");
    return url.origin === origin && id !== null && /^[\w-]{32}$/u.test(id) ? id : null;
  } catch { return null; }
}
