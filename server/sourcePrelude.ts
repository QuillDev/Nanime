/**
 * The JavaScript every source plugin runs on top of: the classes and helpers a
 * Mangayomi JS extension expects (`MProvider`, `Client`, `Document`,
 * `Element`, `SharedPreferences`, console, the Kotlin-style string helpers and
 * the crypto/unpack utilities). They mirror the API of Mangayomi's JS bridge
 * (github.com/kodjodevf/mangayomi, lib/eval/javascript, Apache-2.0) so its
 * extensions run unchanged; every call crosses to Nanime through one
 * `sendMessage(name, jsonArgs)` host function. HTTP calls return promises; the
 * rest answer synchronously, as in Mangayomi.
 */
export const SOURCE_PRELUDE = String.raw`
const __call = (name, args) => sendMessage(name, JSON.stringify(args));

const __log = function (...messages) {
  __call("log", [messages.map((message) => (typeof message === "object" ? JSON.stringify(message) : String(message))).join(" ")]);
};
globalThis.console = { log: __log, warn: __log, error: __log, info: __log, debug: __log };

String.prototype.substringAfter = function (pattern) {
  const index = this.indexOf(pattern);
  return index === -1 ? this.substring(0) : this.substring(index + pattern.length);
};
String.prototype.substringAfterLast = function (pattern) {
  return this.split(pattern).pop();
};
String.prototype.substringBefore = function (pattern) {
  const index = this.indexOf(pattern);
  return index === -1 ? this.substring(0) : this.substring(0, index);
};
String.prototype.substringBeforeLast = function (pattern) {
  const index = this.lastIndexOf(pattern);
  return index === -1 ? this.substring(0) : this.substring(0, index);
};
String.prototype.substringBetween = function (left, right) {
  const index = this.indexOf(left);
  if (index === -1) return "";
  const start = index + left.length;
  const end = this.indexOf(right, start);
  return end === -1 ? "" : this.substring(start, end);
};

class Client {
  constructor(reqcopyWith) {
    this.reqcopyWith = reqcopyWith;
  }
  async request(method, url, headers, body) {
    return JSON.parse(await __call("http", [method, this.reqcopyWith ?? null, url, headers ?? null, body ?? null]));
  }
  head(url, headers) { return this.request("HEAD", url, headers); }
  get(url, headers) { return this.request("GET", url, headers); }
  post(url, headers, body) { return this.request("POST", url, headers, body); }
  // Mangayomi sends these as POST too; extensions written against it expect that.
  put(url, headers, body) { return this.request("POST", url, headers, body); }
  delete(url, headers, body) { return this.request("POST", url, headers, body); }
  patch(url, headers, body) { return this.request("POST", url, headers, body); }
}

class Element {
  constructor(key) { this.key = key; }
  getString(type) { return __call("ele_string", [type, this.key]); }
  get text() { return this.getString("text"); }
  get outerHtml() { return this.getString("outerHtml"); }
  get innerHtml() { return this.getString("innerHtml"); }
  get className() { return this.getString("className"); }
  get localName() { return this.getString("localName"); }
  get namespaceUri() { return this.getString("namespaceUri"); }
  get getSrc() { return this.getString("getSrc"); }
  get getImg() { return this.getString("getImg"); }
  get getHref() { return this.getString("getHref"); }
  get getDataSrc() { return this.getString("getDataSrc"); }
  get previousElementSibling() { return new Element(__call("ele_sibling", ["previous", this.key])); }
  get nextElementSibling() { return new Element(__call("ele_sibling", ["next", this.key])); }
  getElementsListBy(type, name) {
    return JSON.parse(__call("ele_list", [type, name || "", this.key])).map((key) => new Element(key));
  }
  get children() { return this.getElementsListBy("children"); }
  getElementsByTagName(name) { return this.getElementsListBy("tag", name); }
  getElementsByClassName(name) { return this.getElementsListBy("class", name); }
  selectFirst(selector) { return new Element(__call("ele_select_first", [selector, this.key])); }
  select(selector) { return JSON.parse(__call("ele_select", [selector, this.key])).map((key) => new Element(key)); }
  attr(name) { return __call("ele_attr", [name, this.key]); }
  hasAttr(name) { return __call("ele_has_attr", [name, this.key]); }
  xpath() { return []; }
  xpathFirst() { return ""; }
}

class Document {
  constructor(html) { this.key = __call("doc_parse", [String(html ?? "")]); }
  getElement(type) { return new Element(__call("doc_element", [type, this.key])); }
  get body() { return this.getElement("body"); }
  get documentElement() { return this.getElement("documentElement"); }
  get head() { return this.getElement("head"); }
  get parent() { return this.getElement("parent"); }
  getString(type) { return __call("ele_string", [type, this.key]); }
  get text() { return this.getString("text"); }
  get outerHtml() { return this.getString("outerHtml"); }
  selectFirst(selector) { return new Element(__call("ele_select_first", [selector, this.key])); }
  select(selector) { return JSON.parse(__call("ele_select", [selector, this.key])).map((key) => new Element(key)); }
  getElementsListBy(type, name) {
    return JSON.parse(__call("ele_list", [type, name || "", this.key])).map((key) => new Element(key));
  }
  get children() { return this.getElementsListBy("children"); }
  getElementsByTagName(name) { return this.getElementsListBy("tag", name); }
  getElementsByClassName(name) { return this.getElementsListBy("class", name); }
  getElementById(id) { return new Element(__call("doc_by_id", [id, this.key])); }
  attr(name) { return __call("ele_attr", [name, this.key]); }
  hasAttr(name) { return __call("ele_has_attr", [name, this.key]); }
  xpath() { return []; }
  xpathFirst() { return ""; }
}

class SharedPreferences {
  get(key) { return JSON.parse(__call("pref_get", [key])); }
  getString(key, defaultValue) { return __call("pref_get_string", [key, defaultValue ?? ""]); }
  setString(key, value) { return __call("pref_set_string", [key, String(value)]); }
}

function cryptoHandler(text, iv, secretKeyString, encrypt) { return __call("crypto_cbc", [text, iv, secretKeyString, Boolean(encrypt)]); }
function encryptAESCryptoJS(plainText, passphrase) { return __call("crypto_aes_encrypt", [plainText, passphrase]); }
function decryptAESCryptoJS(encrypted, passphrase) { return __call("crypto_aes_decrypt", [encrypted, passphrase]); }
function decryptAESGCM(encrypted, keyHex, ivHex, tagHex = "") { return __call("crypto_gcm", [encrypted, keyHex, ivHex, tagHex]); }
function unpackJs(packed) { return __call("unpack", [packed]); }
function unpackJsAndCombine(script) { return __call("unpack", [script]); }
function parseDates(values, dateFormat, dateFormatLocale) { return JSON.parse(__call("parse_dates", [values, dateFormat ?? "", dateFormatLocale ?? ""])); }
async function createHlsProxyUrl(url) { return url; }
async function evaluateJavascriptViaWebview() { throw new Error("This source needs a web browser, which Nanime doesn't run"); }
for (const name of [
  "sibnetExtractor", "myTvExtractor", "okruExtractor", "voeExtractor", "vidBomExtractor", "quarkVideosExtractor",
  "ucVideosExtractor", "quarkFilesExtractor", "ucFilesExtractor", "streamlareExtractor", "sendVidExtractor",
  "yourUploadExtractor", "gogoCdnExtractor", "doodExtractor", "streamTapeExtractor", "mp4UploadExtractor",
  "streamWishExtractor", "filemoonExtractor",
]) {
  globalThis[name] = async () => { throw new Error(name + " isn't available in Nanime yet"); };
}

/** The plugin's default filters, as Mangayomi passes them to search; none when it declares none. */
function __filters() {
  try {
    return extention.getFilterList() ?? [];
  } catch {
    return [];
  }
}

class MProvider {
  get source() { return __source; }
  get supportsLatest() { return true; }
  getHeaders() { return {}; }
  async getPopular() { throw new Error("getPopular not implemented"); }
  async getLatestUpdates() { throw new Error("getLatestUpdates not implemented"); }
  async search() { throw new Error("search not implemented"); }
  async getDetail() { throw new Error("getDetail not implemented"); }
  async getVideoList() { throw new Error("getVideoList not implemented"); }
  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
`;
