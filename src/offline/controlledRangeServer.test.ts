import { OFFLINE_MEDIA_CHUNK_BYTES } from "./chunks.ts";

interface PendingRequest {
  readonly end: number;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (response: Response) => void;
  readonly start: number;
}

interface ParsedRange {
  readonly end: number;
  readonly index: number;
  readonly start: number;
}

interface DeferredResponse {
  readonly promise: Promise<Response>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: Response | PromiseLike<Response>) => void;
}

function parsedRange(init?: RequestInit): ParsedRange {
  const range = new Headers(init?.headers).get("range") ?? "";
  const match = /^bytes=(?<start>\d+)-(?<end>\d+)$/u.exec(range);
  const start = Number(match?.groups?.["start"]);
  return {
    start,
    end: Number(match?.groups?.["end"]),
    index: Math.floor(start / OFFLINE_MEDIA_CHUNK_BYTES),
  };
}

export class ControlledRangeServer {
  readonly started: number[] = [];
  readonly #pending = new Map<number, PendingRequest>();
  readonly #waiters: { readonly count: number; readonly resolve: () => void }[] = [];
  active = 0;
  maxActive = 0;

  readonly fetch = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const range = parsedRange(init);
    const deferred = Promise.withResolvers<Response>();
    this.beginRequest(range, deferred, init?.signal);
    try {
      return await deferred.promise;
    } finally {
      this.#pending.delete(range.index);
      this.active -= 1;
    }
  };

  waitForStarts(count: number): Promise<void> {
    if (this.started.length >= count) {
      return Promise.resolve();
    }
    const result = Promise.withResolvers<void>();
    this.#waiters.push({ count, resolve: result.resolve });
    return result.promise;
  }

  resolve(index: number, totalBytes: number, fill = index + 1): void {
    const pending = this.#pending.get(index);
    if (pending === undefined) {
      throw new Error(`Range ${String(index)} has not started`);
    }
    pending.resolve(new Response(new Uint8Array(pending.end - pending.start + 1).fill(fill), {
      status: 206,
      headers: {
        "content-range": `bytes ${String(pending.start)}-${String(pending.end)}/${String(totalBytes)}`,
        etag: '"source-v1"',
      },
    }));
  }

  private beginRequest(
    range: ParsedRange,
    deferred: DeferredResponse,
    signal: AbortSignal | null | undefined,
  ): void {
    this.#pending.set(range.index, { ...deferred, end: range.end, start: range.start });
    this.started.push(range.index);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.notifyWaiters();
    signal?.addEventListener("abort", () => {
      deferred.reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }

  private notifyWaiters(): void {
    for (const waiter of this.#waiters.splice(0)) {
      if (this.started.length >= waiter.count) {
        waiter.resolve();
      } else {
        this.#waiters.push(waiter);
      }
    }
  }
}
