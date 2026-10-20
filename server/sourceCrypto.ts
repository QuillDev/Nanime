import { createCipheriv, createDecipheriv, type DecipherGCM } from "node:crypto";
import CryptoJS from "crypto-js";

/**
 * The crypto and unpacking helpers Mangayomi gives extensions. Like
 * Mangayomi, a failure answers with the input unchanged rather than throwing.
 */

interface CbcRequest {
  readonly text: string;
  readonly iv: string;
  readonly key: string;
  readonly encrypt: boolean;
}

/** AES-CBC with UTF-8 key and IV: base64 out when encrypting, UTF-8 out when decrypting. */
export function cryptoHandler({ text, iv, key, encrypt }: CbcRequest): string {
  try {
    const keyBytes = Buffer.from(key, "utf8");
    const algorithm = `aes-${String(keyBytes.byteLength * 8)}-cbc`;
    if (encrypt) {
      const cipher = createCipheriv(algorithm, keyBytes, Buffer.from(iv, "utf8"));
      return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
    }
    const decipher = createDecipheriv(algorithm, keyBytes, Buffer.from(iv, "utf8"));
    return Buffer.concat([decipher.update(text, "base64"), decipher.final()]).toString("utf8");
  } catch {
    return text;
  }
}

/** CryptoJS's passphrase format (OpenSSL "Salted__" with an MD5-derived key). */
export function encryptAesCryptoJs(plainText: string, passphrase: string): string {
  try {
    return CryptoJS.AES.encrypt(plainText, passphrase).toString();
  } catch {
    return plainText;
  }
}

export function decryptAesCryptoJs(encrypted: string, passphrase: string): string {
  try {
    return CryptoJS.AES.decrypt(encrypted, passphrase).toString(CryptoJS.enc.Utf8);
  } catch {
    return encrypted;
  }
}

interface GcmRequest {
  readonly encrypted: string;
  readonly keyHex: string;
  readonly ivHex: string;
  readonly tagHex: string;
}

/** AES-GCM with hex key and IV; the 16-byte tag is appended to the base64 data or given as hex. */
export function decryptAesGcm({ encrypted, keyHex, ivHex, tagHex }: GcmRequest): string {
  try {
    const data = Buffer.concat([Buffer.from(encrypted, "base64"), Buffer.from(tagHex, "hex")]);
    const key = Buffer.from(keyHex, "hex");
    const decipher = createDecipheriv(`aes-${String(key.byteLength * 8)}-gcm`, key, Buffer.from(ivHex, "hex")) as DecipherGCM;
    decipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString("utf8");
  } catch {
    return encrypted;
  }
}

const ALPHABETS = new Map<number, string>([
  [52, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP"],
  [54, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR"],
  [62, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  [95, " !\"#$%&\\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"],
]);

function unbase(word: string, radix: number): number {
  if (radix >= 2 && radix <= 36) {
    const value = Number.parseInt(word, radix);
    return Number.isNaN(value) ? 0 : value;
  }
  const alphabet = ALPHABETS.get(radix) ?? "";
  return [...word].toReversed().reduce((total, character, index) => total + radix ** index * Math.max(0, alphabet.indexOf(character)), 0);
}

const PACKED = /eval[(]function[(]p,a,c,k,e,[rd]?/iu;
const PAYLOAD = /[}][(]'(?<payload>.*)', *(?<radix>\d+), *(?<count>\d+), *'(?<table>.*?)'[.]split[(]'[|]'[)]/giu;

/** Dean Edwards' p,a,c,k,e,d packer, undone the way Mangayomi's JsUnpacker does; "" when nothing is packed. */
export function unpackJs(script: string): string {
  if (!PACKED.test(script)) {
    return "";
  }
  return [...script.matchAll(PAYLOAD)].flatMap((match) => {
    const { payload = "", radix: radixText = "10", count: countText = "0", table = "" } = match.groups ?? {};
    const symbols = table.split("|");
    const radix = Number(radixText) || 10;
    if (symbols.length !== Number(countText)) {
      return [];
    }
    return [payload.replaceAll(/\b\w+\b/gu, (word) => symbols[unbase(word, radix)] || word)];
  }).join(" ");
}
