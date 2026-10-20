import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSDeferredPromise, type QuickJSHandle, type QuickJSRuntime } from "quickjs-emscripten";
import { cryptoHandler, decryptAesCryptoJs, decryptAesGcm, encryptAesCryptoJs, unpackJs } from "./sourceCrypto.ts";
import { setTimeout as sleep } from "node:timers/promises";
import type { JsonValue } from "./json.ts";
import { SourceDom } from "./sourceDom.ts";
import { CookieJar } from "./sourceCookies.ts";
import { sourceFetch } from "./sourceHttp.ts";
import { SOURCE_PRELUDE } from "./sourcePrelude.ts";
import { settingValue, type SourcePreference } from "./sourceSettings.ts";
import { saveSourceSetting, sourceSettings, type InstalledSource } from "./sourceStore.ts";

/**
 * Runs one call into a source plugin inside a fresh QuickJS sandbox, the
 * engine Mangayomi runs extensions in. The plugin sees only the bridge (HTTP to
 * public hosts, HTML parsing, crypto helpers, its own settings); it has no
 * file system, process or network access of its own.
 */
const MEMORY_LIMIT = 256 * 1024 * 1024;
const configuredTimeout = Number(process.env["NANIME_SOURCE_CALL_TIMEOUT_MS"] ?? "");
const CALL_TIMEOUT_MS = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000;
const MAX_REQUESTS = 400;
const MAX_LOG_LINES = 40;

export class SourceError extends Error {
  override name = "SourceError";
}

const quickJs = getQuickJS();

interface Call {
  readonly source: InstalledSource;
  readonly vm: QuickJSContext;
  readonly runtime: QuickJSRuntime;
  readonly dom: SourceDom;
  readonly jar: CookieJar;
  readonly pending: Set<QuickJSDeferredPromise>;
  readonly log: string[];
  preferences: readonly SourcePreference[];
  requests: number;
}

type Arguments = readonly unknown[];
/** What a synchronous bridge call hands back into the sandbox. */
type BridgeValue = string | number | boolean | null;

const text = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

/** The synchronous half of the bridge: HTML, crypto, settings and logging. */
function answer(call: Call, name: string, args: Arguments): BridgeValue {
  return name.startsWith("doc_") || name.startsWith("ele_") ? domAnswer(call, name, args) : utilityAnswer(call, name, args);
}

function domAnswer(call: Call, name: string, [a, b, c]: Arguments): BridgeValue {
  switch (name) {
    case "doc_parse": { return call.dom.parse(text(a)); }
    case "doc_element": { return call.dom.documentElement(text(a), b); }
    case "doc_by_id": { return call.dom.byId(text(a), b); }
    case "ele_string": { return call.dom.text(text(a), b); }
    case "ele_select_first": { return call.dom.selectFirst(text(a), b); }
    case "ele_select": { return JSON.stringify(call.dom.select(text(a), b)); }
    case "ele_list": { return JSON.stringify(call.dom.list(text(a), text(b), c)); }
    case "ele_sibling": { return call.dom.sibling(text(a), b); }
    case "ele_attr": { return call.dom.attr(text(a), b); }
    case "ele_has_attr": { return call.dom.hasAttr(text(a), b); }
    default: { throw new SourceError(`Unknown bridge call ${name}`); }
  }
}

function utilityAnswer(call: Call, name: string, args: Arguments): BridgeValue {
  const [a, b, c, d] = args;
  switch (name) {
    case "crypto_cbc": { return cryptoHandler({ text: text(a), iv: text(b), key: text(c), encrypt: d === true }); }
    case "crypto_aes_encrypt": { return encryptAesCryptoJs(text(a), text(b)); }
    case "crypto_aes_decrypt": { return decryptAesCryptoJs(text(a), text(b)); }
    case "crypto_gcm": { return decryptAesGcm({ encrypted: text(a), keyHex: text(b), ivHex: text(c), tagHex: text(d) }); }
    case "unpack": { return unpackJs(text(a)); }
    default: { return settingsAnswer(call, name, args); }
  }
}

function settingsAnswer(call: Call, name: string, [a, b]: Arguments): BridgeValue {
  const stored = sourceSettings(call.source.id);
  switch (name) {
    case "pref_get": { return JSON.stringify(settingValue(call.preferences, stored, text(a)) ?? null); }
    case "pref_get_string": {
      const value = stored.get(`string:${text(a)}`);
      return typeof value === "string" ? value : text(b);
    }
    case "pref_set_string": {
      saveSourceSetting(call.source.id, `string:${text(a)}`, text(b));
      return true;
    }
    case "log": {
      call.log.push(text(a).slice(0, 500));
      call.log.splice(0, Math.max(0, call.log.length - MAX_LOG_LINES));
      return null;
    }
    default: { throw new SourceError(`Unknown bridge call ${name}`); }
  }
}

function toHandle(vm: QuickJSContext, value: BridgeValue): QuickJSHandle {
  if (typeof value === "number") {
    return vm.newNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? vm.true : vm.false;
  }
  return value === null ? vm.null : vm.newString(value);
}

interface HttpOptions {
  readonly followRedirects?: unknown;
}

type Outcome = { readonly ok: string } | { readonly error: string };

/** Settles a plugin's pending request, unless the call already ended. */
function settleRequest(call: Call, deferred: QuickJSDeferredPromise, outcome: Outcome): void {
  if (!call.pending.delete(deferred) || !call.vm.alive) {
    return;
  }
  const handle = "ok" in outcome ? call.vm.newString(outcome.ok) : call.vm.newError(outcome.error);
  if ("ok" in outcome) {
    deferred.resolve(handle);
  } else {
    deferred.reject(handle);
  }
  handle.dispose();
  deferred.dispose();
  call.runtime.executePendingJobs();
}

async function fetchFor(call: Call, args: Arguments): Promise<Outcome> {
  const [method, options, url, headers, body] = args;
  if (call.requests > MAX_REQUESTS) {
    return { error: "This source made too many requests" };
  }
  const followRedirects = (options as HttpOptions | null)?.followRedirects !== false;
  try {
    return { ok: await sourceFetch({ method: text(method), url: text(url), headers: stringRecord(headers), body, followRedirects }, call.jar) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The asynchronous half: HTTP, answered by settling a QuickJS promise. */
function request(call: Call, args: Arguments): QuickJSHandle {
  const deferred = call.vm.newPromise();
  call.pending.add(deferred);
  call.requests += 1;
  void (async () => {
    settleRequest(call, deferred, await fetchFor(call, args));
  })();
  return deferred.handle;
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, text(entry)]));
}

function installBridge(call: Call): void {
  const { vm } = call;
  const send = vm.newFunction("sendMessage", (nameHandle, argsHandle) => {
    const name = vm.getString(nameHandle);
    const args = JSON.parse(vm.getString(argsHandle)) as Arguments;
    if (name === "http") {
      return request(call, args);
    }
    try {
      return toHandle(vm, answer(call, name, args));
    } catch (error) {
      return { error: vm.newError(error instanceof Error ? error.message : String(error)) };
    }
  });
  vm.setProp(vm.global, "sendMessage", send);
  send.dispose();
}

function evaluate(call: Call, code: string, what: string): QuickJSHandle {
  const result = call.vm.evalCode(code, `${call.source.name}.js`);
  if (result.error !== undefined) {
    const error = call.vm.dump(result.error) as unknown;
    result.error.dispose();
    throw new SourceError(`${call.source.name} failed while ${what}: ${describe(error)}`);
  }
  return result.value;
}

function describe(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return text((error as { readonly message: unknown }).message);
  }
  return text(error);
}

function load(call: Call): void {
  evaluate(call, `const __source = ${JSON.stringify(call.source.info)};\n${SOURCE_PRELUDE}`, "starting").dispose();
  evaluate(call, `${call.source.code}\nvar extention = new DefaultExtension();`, "loading").dispose();
  const preferences = evaluate(call, "(() => { try { return JSON.stringify(extention.getSourcePreferences() ?? []); } catch { return \"[]\"; } })()", "reading its settings");
  call.preferences = JSON.parse(call.vm.getString(preferences)) as readonly SourcePreference[];
  preferences.dispose();
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
async function deadline(ms: number, signal: AbortSignal): Promise<{ readonly timedOut: true }> {
  try {
    await sleep(ms, undefined, { signal });
  } catch {
    // Aborted: the call finished first.
  }
  return { timedOut: true };
}

async function settle(call: Call, expression: string, what: string): Promise<JsonValue> {
  const promise = evaluate(call, `(async () => JSON.stringify((await (${expression})) ?? null))()`, what);
  const native = call.vm.resolvePromise(promise);
  promise.dispose();
  call.runtime.executePendingJobs();
  const finished = new AbortController();
  const outcome = await Promise.race([native, deadline(CALL_TIMEOUT_MS, finished.signal)]);
  finished.abort();
  if ("timedOut" in outcome) {
    throw new SourceError(`${call.source.name} took too long while ${what}`);
  }
  if (outcome.error !== undefined) {
    const error = call.vm.dump(outcome.error) as unknown;
    outcome.error.dispose();
    throw new SourceError(`${call.source.name} failed while ${what}: ${describe(error)}`);
  }
  const json = call.vm.getString(outcome.value);
  outcome.value.dispose();
  return JSON.parse(json) as JsonValue;
}

/**
 * Evaluates `expression` (JavaScript over `extention`, e.g. `extention.search("x", 1, [])`)
 * and returns its JSON result. `what` names the step in error messages.
 */
export async function runSource(source: InstalledSource, expression: string, what: string): Promise<JsonValue> {
  const module = await quickJs;
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + CALL_TIMEOUT_MS));
  const vm = runtime.newContext();
  const call: Call = { source, vm, runtime, dom: new SourceDom(), jar: new CookieJar(), pending: new Set(), log: [], preferences: [], requests: 0 };
  try {
    installBridge(call);
    load(call);
    return await settle(call, expression, what);
  } catch (error) {
    if (error instanceof SourceError && call.log.length > 0) {
      console.warn(`[source ${source.name}] ${call.log.join("\n")}`);
    }
    throw error;
  } finally {
    for (const deferred of call.pending) {
      deferred.dispose();
    }
    call.pending.clear();
    vm.dispose();
    runtime.dispose();
  }
}

/** The plugin's settings as it declares them, for showing and editing. */
export async function sourcePreferences(source: InstalledSource): Promise<readonly SourcePreference[]> {
  const result = await runSource(source, "extention.getSourcePreferences()", "reading its settings");
  return Array.isArray(result) ? result as readonly SourcePreference[] : [];
}
