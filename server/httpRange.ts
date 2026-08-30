import { createReadStream } from "node:fs";

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

function suffixRange(text: string, size: number): ByteRange | "invalid" {
  const suffix = Number(text);
  return Number.isSafeInteger(suffix) && suffix > 0
    ? { start: Math.max(0, size - suffix), end: size - 1 }
    : "invalid";
}

function explicitRange(startText: string, endText: string, size: number): ByteRange | "invalid" {
  const start = Number(startText);
  const requestedEnd = endText === "" ? size - 1 : Number(endText);
  return Number.isSafeInteger(start) && Number.isSafeInteger(requestedEnd) &&
    start < size && start <= requestedEnd
    ? { start, end: Math.min(size - 1, requestedEnd) }
    : "invalid";
}

export function parseByteRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (header === null) {
    return null;
  }
  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/u.exec(header);
  if (match?.groups === undefined || size <= 0) {
    return "invalid";
  }
  const startText = match.groups["start"] ?? "";
  const endText = match.groups["end"] ?? "";
  if (startText === "" && endText === "") {
    return "invalid";
  }
  return startText === ""
    ? suffixRange(endText, size)
    : explicitRange(startText, endText, size);
}

interface ResponseByteRangeOptions {
  readonly rangeHeader: string | null;
  readonly ifRange: string | null;
  readonly etag: string;
  readonly size: number;
}

export function responseByteRange(options: ResponseByteRangeOptions): ByteRange | null | "invalid" {
  return options.ifRange !== null && options.ifRange !== options.etag
    ? null
    : parseByteRange(options.rangeHeader, options.size);
}

interface FileResponseOptions {
  readonly path: string;
  readonly mimeType: string;
  readonly etag: string;
  readonly req: Request;
}

function fileRangeStream(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  const source = createReadStream(path, { start, end });
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done === true) {
        controller.close();
      } else {
        controller.enqueue(result.value);
      }
    },
    cancel() {
      source.destroy();
    },
  });
}

export function rangedFileResponse(options: FileResponseOptions): Response {
  const { path, mimeType, etag, req } = options;
  const file = Bun.file(path);
  const range = responseByteRange({
    rangeHeader: req.headers.get("range"),
    ifRange: req.headers.get("if-range"),
    etag,
    size: file.size,
  });
  const common = {
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "content-type": mimeType,
    etag,
  };
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...common, "content-range": `bytes */${String(file.size)}` },
    });
  }
  if (range === null) {
    return new Response(req.method === "HEAD" ? null : file, {
      headers: { ...common, "content-length": String(file.size) },
    });
  }
  const body = req.method === "HEAD" ? null : fileRangeStream(path, range.start, range.end);
  return new Response(body, {
    status: 206,
    headers: {
      ...common,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(file.size)}`,
    },
  });
}
