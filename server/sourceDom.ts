import { load, type Cheerio, type CheerioAPI } from "cheerio";
import { isTag, type AnyNode } from "domhandler";

/**
 * HTML parsing for source plugins: each parsed document and every element a
 * plugin holds gets a numeric key, as Mangayomi's bridge hands out. A missing
 * match is still a key (to nothing), so `selectFirst` always returns an
 * Element whose text and attributes read as "".
 */
interface Held {
  readonly $: CheerioAPI;
  readonly node: AnyNode;
}

/** Mangayomi's `getSrc`-style getters: the first `name="..."` in the element's HTML. */
const ATTRIBUTE_GETTERS = new Map(Object.entries({ getSrc: "src", getImg: "img", getHref: "href", getDataSrc: "data-src" }));

/** CSS selection under `selection` (cheerio's `find` takes a selector, not a callback). */
function within(selection: Cheerio<AnyNode>, selector: string): Cheerio<AnyNode> {
  // eslint-disable-next-line unicorn/no-array-callback-reference
  return selection.find(selector);
}

export class SourceDom {
  private readonly nodes = new Map<number, Held | null>();
  private nextKey = 0;

  private keep(held: Held | null): number {
    this.nextKey += 1;
    this.nodes.set(this.nextKey, held);
    return this.nextKey;
  }

  private held(key: unknown): Held | null {
    return typeof key === "number" ? this.nodes.get(key) ?? null : null;
  }

  /** Keeps whatever `pick` finds next to the node `key` points at (nothing when it points at nothing). */
  private keepFrom(key: unknown, pick: (selection: Cheerio<AnyNode>, $: CheerioAPI) => AnyNode | undefined): number {
    const held = this.held(key);
    const node = held === null ? undefined : pick(held.$(held.node), held.$);
    return this.keep(held === null || node === undefined ? null : { $: held.$, node });
  }

  private keepAll(key: unknown, pick: (selection: Cheerio<AnyNode>) => Cheerio<AnyNode>): readonly number[] {
    const held = this.held(key);
    if (held === null) {
      return [];
    }
    try {
      return pick(held.$(held.node)).toArray().map((node) => this.keep({ $: held.$, node }));
    } catch {
      // Mangayomi answers an unparseable selector with no match.
      return [];
    }
  }

  parse(html: string): number {
    const $ = load(html);
    const [root] = $.root().toArray();
    return this.keep(root === undefined ? null : { $, node: root });
  }

  documentElement(type: string, key: unknown): number {
    const selector = type === "documentElement" ? "html" : type;
    return this.keepFrom(key, (selection) => (type === "parent" ? undefined : within(selection, selector).toArray()[0]));
  }

  text(type: string, key: unknown): string {
    const held = this.held(key);
    if (held === null) {
      return "";
    }
    const attribute = ATTRIBUTE_GETTERS.get(type);
    if (attribute !== undefined) {
      return new RegExp(`${attribute}="([^"]+)"`, "u").exec(held.$.html(held.node))?.[1] ?? "";
    }
    return property(type, held);
  }

  selectFirst(selector: string, key: unknown): number {
    const [first] = this.keepAll(key, (selection) => within(selection, selector).first());
    return first ?? this.keep(null);
  }

  select(selector: string, key: unknown): readonly number[] {
    return this.keepAll(key, (selection) => within(selection, selector));
  }

  list(type: string, name: string, key: unknown): readonly number[] {
    return this.keepAll(key, (selection) => {
      if (type === "tag") {
        return within(selection, name);
      }
      return type === "class" ? within(selection, `.${name.trim().split(/\s+/u).join(".")}`) : selection.children();
    });
  }

  byId(id: string, key: unknown): number {
    return this.keepFrom(key, (selection) => within(selection, "[id]").toArray().find((node) => isTag(node) && node.attribs["id"] === id));
  }

  sibling(direction: string, key: unknown): number {
    return this.keepFrom(key, (selection) => (direction === "next" ? selection.next() : selection.prev())[0]);
  }

  attr(name: string, key: unknown): string {
    const held = this.held(key);
    return held !== null && isTag(held.node) ? held.node.attribs[name] ?? "" : "";
  }

  hasAttr(name: string, key: unknown): boolean {
    const held = this.held(key);
    return held !== null && isTag(held.node) && held.node.attribs[name] !== undefined;
  }
}

function property(type: string, { $, node }: Held): string {
  switch (type) {
    case "text": { return $(node).text(); }
    case "innerHtml": { return $(node).html() ?? ""; }
    case "outerHtml": { return $.html(node); }
    case "className": { return isTag(node) ? node.attribs["class"] ?? "" : ""; }
    case "localName": { return isTag(node) ? node.tagName : ""; }
    case "namespaceUri": { return isTag(node) ? node.namespace ?? "" : ""; }
    default: { return ""; }
  }
}
