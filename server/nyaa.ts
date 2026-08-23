import { jsonObject } from "./json.ts";
import type { NyaaSearchResult } from "../shared/types.ts";

const NYAA_ORIGIN = "https://nyaa.si";
const SEARCH_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 50;
const CATEGORIES = new Set(["1_0", "1_2", "1_3", "1_4"]);
const SORTS = new Set(["id", "size", "seeders", "leechers", "downloads"]);
const SORT_ORDERS = new Set(["asc", "desc"]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? decodeXml(value) : null;
}

function validCodePoint(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 1_114_111
    ? String.fromCodePoint(codePoint)
    : "�";
}

function decodeXml(value: string): string {
  return value
    .replaceAll(/&#(?<decimal>\d+);/gu, (_entity, decimal: string) => (
      validCodePoint(decimal, 10)
    ))
    .replaceAll(/&#x(?<hex>[\da-f]+);/giu, (_entity, hex: string) => (
      validCodePoint(hex, 16)
    ))
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function magnetLink(infoHash: string, name: string): string {
  const params = new URLSearchParams({
    xt: `urn:btih:${infoHash}`,
    dn: name,
  });
  return `magnet:?${params.toString()}`;
}

function searchResult(value: unknown): NyaaSearchResult | null {
  const item = jsonObject(value);
  if (item === null) {
    return null;
  }
  const name = stringValue(item["title"]);
  const category = stringValue(item["nyaa:category"]);
  const size = stringValue(item["nyaa:size"]);
  const infoHash = stringValue(item["nyaa:infoHash"]);
  const detailsUrl = stringValue(item["guid"]);
  const published = stringValue(item["pubDate"]);
  const seeders = numberValue(item["nyaa:seeders"]);
  const leechers = numberValue(item["nyaa:leechers"]);
  const downloads = numberValue(item["nyaa:downloads"]);
  const idMatch = detailsUrl === null ? null : /^https:\/\/nyaa\.si\/view\/(?<id>\d+)$/u.exec(detailsUrl);
  const publishedAt = published === null ? Number.NaN : Date.parse(published);
  if (
    name === null || category === null || size === null ||
    infoHash === null || !/^[a-f\d]{40}$/iu.test(infoHash) ||
    detailsUrl === null || idMatch?.groups?.["id"] === undefined ||
    !Number.isFinite(publishedAt) || seeders === null || leechers === null || downloads === null
  ) {
    return null;
  }
  return {
    id: idMatch.groups["id"],
    name,
    category,
    size,
    seeders,
    leechers,
    downloads,
    publishedAt: new Date(publishedAt).toISOString(),
    trusted: item["nyaa:trusted"] === "Yes",
    remake: item["nyaa:remake"] === "Yes",
    detailsUrl,
    magnet: magnetLink(infoHash, name),
  };
}

const FEED_FIELDS = [
  ["title", "title"],
  ["guid", "guid"],
  ["pubdate", "pubDate"],
  [String.raw`nyaa\:category`, "nyaa:category"],
  [String.raw`nyaa\:size`, "nyaa:size"],
  [String.raw`nyaa\:infohash`, "nyaa:infoHash"],
  [String.raw`nyaa\:seeders`, "nyaa:seeders"],
  [String.raw`nyaa\:leechers`, "nyaa:leechers"],
  [String.raw`nyaa\:downloads`, "nyaa:downloads"],
  [String.raw`nyaa\:trusted`, "nyaa:trusted"],
  [String.raw`nyaa\:remake`, "nyaa:remake"],
] as const;

function feedTextHandler(
  field: string,
  currentItem: () => Record<string, string> | null,
): HTMLRewriterTypes.HTMLRewriterElementContentHandlers {
  return {
    text(text) {
      const item = currentItem();
      if (item !== null) {
        item[field] = (item[field] ?? "") + text.text;
      }
    },
  };
}

async function parseFeed(xml: string): Promise<readonly NyaaSearchResult[]> {
  const results: NyaaSearchResult[] = [];
  let current: Record<string, string> | null = null;
  const rewriter = new HTMLRewriter().on("item", {
    element(element) {
      const item: Record<string, string> = {};
      current = item;
      element.onEndTag(() => {
        const result = searchResult(item);
        if (result !== null && results.length < MAX_RESULTS) {
          results.push(result);
        }
        current = null;
      });
    },
  });
  const currentItem = (): Record<string, string> | null => current;
  for (const [selector, field] of FEED_FIELDS) {
    rewriter.on(`item > ${selector}`, feedTextHandler(field, currentItem));
  }
  await rewriter.transform(new Response(xml)).text();
  return results;
}

export async function searchNyaaResponse(url: URL): Promise<Response> {
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requestedCategory = url.searchParams.get("category") ?? "1_0";
  const category = CATEGORIES.has(requestedCategory) ? requestedCategory : "1_0";
  const trusted = url.searchParams.get("trusted") === "true";
  const requestedSort = url.searchParams.get("sort") ?? "id";
  const sort = SORTS.has(requestedSort) ? requestedSort : "id";
  const requestedOrder = url.searchParams.get("order") ?? "desc";
  const order = SORT_ORDERS.has(requestedOrder) ? requestedOrder : "desc";
  if (query.length < 2 || query.length > 200) {
    return new Response("Search must be between 2 and 200 characters", { status: 400 });
  }

  const searchUrl = new URL("/", NYAA_ORIGIN);
  searchUrl.search = new URLSearchParams({
    page: "rss",
    q: query,
    c: category,
    f: trusted ? "2" : "0",
    s: sort,
    o: order,
  }).toString();

  try {
    const response = await fetch(searchUrl, {
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9",
        "user-agent": "Nanime/1.0",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return new Response("Nyaa rejected the search request", { status: 502 });
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_FEED_BYTES) {
      return new Response("Nyaa returned an unexpectedly large response", { status: 502 });
    }
    const feed = await response.text();
    if (new TextEncoder().encode(feed).byteLength > MAX_FEED_BYTES) {
      return new Response("Nyaa returned an unexpectedly large response", { status: 502 });
    }
    return Response.json(await parseFeed(feed));
  } catch {
    return new Response("Could not search Nyaa", { status: 502 });
  }
}
