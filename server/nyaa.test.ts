import { expect, test } from "bun:test";
import { searchNyaaResponse } from "./nyaa.ts";

const SEARCH_PAGE = `
  <table class="torrent-list"><tbody>
    <tr class="success">
      <td><a title="Anime - English-translated"></a></td>
      <td><a href="/view/12345" title="Example release"></a></td>
      <td><a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&amp;dn=Example"></a></td>
      <td>1.2 GiB</td>
      <td data-timestamp="1"></td>
      <td>321</td>
      <td>4</td>
      <td>567</td>
    </tr>
  </tbody></table>
`;

test("uses Nyaa's sortable HTML search results", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = Object.assign(
    (input: string | URL | Request): Promise<Response> => {
      requestedUrl = String(input);
      return Promise.resolve(new Response(SEARCH_PAGE));
    },
    { preconnect: originalFetch.preconnect },
  );

  try {
    const response = await searchNyaaResponse(new URL(
      "http://localhost/api/torrents/search?q=example&sort=seeders&order=desc",
    ));
    const payload: unknown = await response.json();
    expect(requestedUrl).toContain("s=seeders");
    expect(requestedUrl).toContain("o=desc");
    expect(requestedUrl).not.toContain("page=rss");
    expect(payload).toEqual([{
      id: "12345",
      name: "Example release",
      category: "Anime - English-translated",
      size: "1.2 GiB",
      seeders: 321,
      leechers: 4,
      downloads: 567,
      publishedAt: "1970-01-01T00:00:01.000Z",
      trusted: true,
      remake: false,
      detailsUrl: "https://nyaa.si/view/12345",
      magnet: "magnet:?xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef01234567&dn=Example+release",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
