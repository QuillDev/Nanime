/** Cookies a plugin's requests set, kept for the rest of that one call. */
export class CookieJar {
  private readonly cookies = new Map<string, Map<string, string>>();

  header(url: URL): string | null {
    const jar = this.cookies.get(url.hostname);
    return jar === undefined || jar.size === 0 ? null : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  store(url: URL, response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";", 1);
      const split = pair.indexOf("=");
      if (split > 0) {
        const jar = this.cookies.get(url.hostname) ?? new Map<string, string>();
        jar.set(pair.slice(0, split).trim(), pair.slice(split + 1).trim());
        this.cookies.set(url.hostname, jar);
      }
    }
  }
}
