import { expect, test } from "bun:test";
import { searchNyaaResponse } from "./nyaa.ts";
import { withFakeUpstream } from "./testFetch.ts";

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

/** Searches through a fake Nyaa and returns the URL Nanime requested plus the results it returned. */
async function search(query: string): Promise<{ readonly requested: URL; readonly results: unknown }> {
  let requested = new URL("about:blank");
  const results = await withFakeUpstream((url) => {
    requested = url;
    return new Response(SEARCH_PAGE);
  }, async () => {
    const response = await searchNyaaResponse(new URL(`http://localhost/api/torrents/search?${query}`));
    return await response.json() as unknown;
  });
  return { requested, results };
}

test("uses Nyaa's sortable HTML search results", async () => {
  const { requested, results } = await search("q=example&sort=seeders&order=desc");

  expect(requested.searchParams.get("s")).toBe("seeders");
  expect(requested.searchParams.get("o")).toBe("desc");
  expect(requested.searchParams.get("page")).toBeNull();
  expect(results).toEqual([{
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
});

test("searches by seeders, most first, when no sort is given", async () => {
  const { requested } = await search("q=example");

  expect(requested.searchParams.get("s")).toBe("seeders");
  expect(requested.searchParams.get("o")).toBe("desc");
});
