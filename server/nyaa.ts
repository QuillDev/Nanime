import { jsonObject } from "./json.ts";
import type { NyaaSearchResult } from "../shared/types.ts";

const NYAA_ORIGIN = "https://nyaa.si";
const SEARCH_TIMEOUT_MS = 10_000;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
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

interface SearchIdentityInput {
  readonly name: string | null;
  readonly category: string | null;
  readonly size: string | null;
  readonly infoHash: string | null;
  readonly detailsUrl: string | null;
  readonly id: string | undefined;
}

function searchIdentity(values: SearchIdentityInput): {
  readonly name: string;
  readonly category: string;
  readonly size: string;
  readonly infoHash: string;
  readonly detailsUrl: string;
  readonly id: string;
} | null {
  if (values.name === null || values.category === null || values.size === null ||
    values.infoHash === null || !/^[a-f\d]{40}$/iu.test(values.infoHash) ||
    values.detailsUrl === null || values.id === undefined) {
    return null;
  }
  return { ...values, name: values.name, category: values.category, size: values.size,
    infoHash: values.infoHash, detailsUrl: values.detailsUrl, id: values.id };
}

function searchStats(values: {
  readonly publishedAt: number;
  readonly seeders: number | null;
  readonly leechers: number | null;
  readonly downloads: number | null;
}): { readonly seeders: number; readonly leechers: number; readonly downloads: number } | null {
  const { publishedAt, seeders, leechers, downloads } = values;
  if (!Number.isFinite(publishedAt) || seeders === null || leechers === null || downloads === null) {
    return null;
  }
  return { seeders, leechers, downloads };
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
  const id = idMatch?.groups?.["id"];
  const identity = searchIdentity({ name, category, size, infoHash, detailsUrl, id });
  const stats = searchStats({ publishedAt, seeders, leechers, downloads });
  if (identity === null || stats === null) {
    return null;
  }
  return {
    id: identity.id,
    name: identity.name,
    category: identity.category,
    size: identity.size,
    ...stats,
    publishedAt: new Date(publishedAt).toISOString(),
    trusted: item["nyaa:trusted"] === "Yes",
    remake: item["nyaa:remake"] === "Yes",
    detailsUrl: identity.detailsUrl,
    magnet: magnetLink(identity.infoHash, identity.name),
  };
}

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

function setAttribute(
  field: string,
  attribute: string,
  currentItem: () => Record<string, string> | null,
): HTMLRewriterTypes.HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      const item = currentItem();
      const value = element.getAttribute(attribute);
      if (item !== null && value !== null) {
        item[field] = value;
      }
    },
  };
}

function setDetails(currentItem: () => Record<string, string> | null): HTMLRewriterTypes.HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      const item = currentItem();
      const href = element.getAttribute("href");
      const id = href === null ? null : /^\/view\/(?<id>\d+)$/u.exec(href)?.groups?.["id"];
      const title = element.getAttribute("title");
      if (item !== null && id !== null && id !== undefined && title !== null) {
        item["guid"] = `${NYAA_ORIGIN}/view/${id}`;
        item["title"] = title;
      }
    },
  };
}

function setMagnet(currentItem: () => Record<string, string> | null): HTMLRewriterTypes.HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      const item = currentItem();
      const href = element.getAttribute("href")?.replaceAll("&amp;", "&");
      if (item === null || href === undefined) {
        return;
      }
      try {
        const exactTopic = new URL(href).searchParams.get("xt");
        const infoHash = exactTopic === null ? null : /^urn:btih:(?<hash>[a-f\d]{40})$/iu.exec(exactTopic)?.groups?.["hash"];
        if (infoHash !== null && infoHash !== undefined) {
          item["nyaa:infoHash"] = infoHash;
        }
      } catch {
        // Ignore malformed links from the upstream search page.
      }
    },
  };
}

function dataTimestamp(element: HTMLRewriterTypes.Element): string | undefined {
  for (const [name, value] of element.attributes) {
    if (name === "data-timestamp") {
      return value;
    }
  }
  return undefined;
}

function setPublishedAt(currentItem: () => Record<string, string> | null): HTMLRewriterTypes.HTMLRewriterElementContentHandlers {
  return {
    element(element) {
      const item = currentItem();
      const timestamp = dataTimestamp(element);
      if (item !== null && timestamp !== undefined && /^\d+$/u.test(timestamp)) {
        item["pubDate"] = new Date(Number(timestamp) * 1e3).toISOString();
      }
    },
  };
}

async function parseSearchPage(html: string): Promise<readonly NyaaSearchResult[]> {
  const results: NyaaSearchResult[] = [];
  let current: Record<string, string> | null = null;
  const rewriter = new HTMLRewriter().on("table.torrent-list > tbody > tr", {
    element(element) {
      const item: Record<string, string> = {};
      const rowClass = element.getAttribute("class");
      item["nyaa:trusted"] = rowClass === "success" ? "Yes" : "No";
      item["nyaa:remake"] = rowClass === "danger" ? "Yes" : "No";
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
  rewriter
    .on("table.torrent-list > tbody > tr > td:nth-child(1) a", setAttribute("nyaa:category", "title", currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(2) a", setDetails(currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(3) a[href^='magnet:']", setMagnet(currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(4)", feedTextHandler("nyaa:size", currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(5)", setPublishedAt(currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(6)", feedTextHandler("nyaa:seeders", currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(7)", feedTextHandler("nyaa:leechers", currentItem))
    .on("table.torrent-list > tbody > tr > td:nth-child(8)", feedTextHandler("nyaa:downloads", currentItem));
  await rewriter.transform(new Response(html)).text();
  return results;
}

export async function searchNyaaResponse(url: URL): Promise<Response> {
  const options = nyaaSearchOptions(url);
  const { query } = options;
  if (query.length < 2 || query.length > 200) {
    return new Response("Search must be between 2 and 200 characters", { status: 400 });
  }

  const searchUrl = new URL("/", NYAA_ORIGIN);
  searchUrl.search = new URLSearchParams({
    q: query,
    c: options.category,
    f: options.trusted ? "2" : "0",
    s: options.sort,
    o: options.order,
  }).toString();

  try {
    const response = await fetch(searchUrl, {
      headers: {
        accept: "text/html",
        "user-agent": "Nanime/1.0",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return new Response("Nyaa rejected the search request", { status: 502 });
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_SEARCH_BYTES) {
      return new Response("Nyaa returned an unexpectedly large response", { status: 502 });
    }
    const page = await response.text();
    if (new TextEncoder().encode(page).byteLength > MAX_SEARCH_BYTES) {
      return new Response("Nyaa returned an unexpectedly large response", { status: 502 });
    }
    return Response.json(await parseSearchPage(page));
  } catch {
    return new Response("Could not search Nyaa", { status: 502 });
  }
}

function nyaaSearchOptions(url: URL) {
  const requestedCategory = url.searchParams.get("category") ?? "1_0";
  const requestedSort = url.searchParams.get("sort") ?? "id";
  const requestedOrder = url.searchParams.get("order") ?? "desc";
  return {
    query: url.searchParams.get("q")?.trim() ?? "",
    category: CATEGORIES.has(requestedCategory) ? requestedCategory : "1_0",
    trusted: url.searchParams.get("trusted") === "true",
    sort: SORTS.has(requestedSort) ? requestedSort : "id",
    order: SORT_ORDERS.has(requestedOrder) ? requestedOrder : "desc",
  };
}
