/**
 * External hosts Nanime is allowed to fetch and proxy show/episode art from.
 * Shared by the server art proxy, browser art URL builder, and episode providers.
 */
export const ART_HOSTS = [
  "s4.anilist.co",
  "img1.ak.crunchyroll.com",
  "artworks.thetvdb.com",
  "image.tmdb.org",
] as const;

const ALLOWED_ART_HOSTS = new Set<string>(ART_HOSTS);

export function isAllowedArtHost(hostname: string): boolean {
  return ALLOWED_ART_HOSTS.has(hostname);
}

export function isAllowedArtUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && url.port === "" && ALLOWED_ART_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
