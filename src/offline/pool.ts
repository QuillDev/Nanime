export const OFFLINE_MEDIA_PARALLEL_REQUESTS = 8;

type PoolTask<T> = () => Promise<T>;

interface QueuedTask<T> {
  readonly removeAbortListener: () => void;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly signal: AbortSignal;
  readonly task: PoolTask<T>;
}

let activeTasks = 0;
const pendingTasks: QueuedTask<unknown>[] = [];

function abortError(): DOMException {
  return new DOMException("The offline download was cancelled", "AbortError");
}

async function executeQueuedTask(item: QueuedTask<unknown>): Promise<void> {
  try {
    item.resolve(await item.task());
  } catch (error: unknown) {
    item.reject(error);
  } finally {
    activeTasks -= 1;
    pumpPool();
  }
}

function runQueuedTask(item: QueuedTask<unknown>): void {
  item.removeAbortListener();
  activeTasks += 1;
  void executeQueuedTask(item);
}

function pumpPool(): void {
  while (activeTasks < OFFLINE_MEDIA_PARALLEL_REQUESTS) {
    const item = pendingTasks.shift();
    if (item === undefined) {
      return;
    }
    if (item.signal.aborted) {
      item.reject(abortError());
    } else {
      runQueuedTask(item);
    }
  }
}

export function runInOfflineMediaPool<T>(task: PoolTask<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  const result = Promise.withResolvers<T>();
  const abort = () => {
    const index = pendingTasks.indexOf(item);
    if (index !== -1) {
      pendingTasks.splice(index, 1);
      result.reject(abortError());
    }
  };
  const item = {
    ...result,
    signal,
    task,
    removeAbortListener: () => signal.removeEventListener("abort", abort),
  } as QueuedTask<unknown>;
  signal.addEventListener("abort", abort, { once: true });
  pendingTasks.push(item);
  pumpPool();
  return result.promise;
}
