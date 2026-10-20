import { cryptoHandler, decryptAesCryptoJs, decryptAesGcm, encryptAesCryptoJs, unpackJs } from "./sourceCrypto.ts";
import { parseDates } from "./sourceDates.ts";

/** What a synchronous bridge call hands back into the sandbox. */
export type BridgeValue = string | number | boolean | null;

const text = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

/** Mangayomi's stateless helpers (crypto, unpacking, dates); undefined for any other call. */
export function utilityAnswer(name: string, args: readonly unknown[]): BridgeValue | undefined {
  const [a, b, c, d] = args;
  switch (name) {
    case "crypto_cbc": { return cryptoHandler({ text: text(a), iv: text(b), key: text(c), encrypt: d === true }); }
    case "crypto_aes_encrypt": { return encryptAesCryptoJs(text(a), text(b)); }
    case "crypto_aes_decrypt": { return decryptAesCryptoJs(text(a), text(b)); }
    case "crypto_gcm": { return decryptAesGcm({ encrypted: text(a), keyHex: text(b), ivHex: text(c), tagHex: text(d) }); }
    case "unpack": { return unpackJs(text(a)); }
    case "parse_dates": { return JSON.stringify(parseDates(Array.isArray(a) ? a : [], text(b), text(c))); }
    default: { return undefined; }
  }
}
