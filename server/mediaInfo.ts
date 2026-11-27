const MAX_DURATION_CACHE = 2000;
const durationCache = new Map<string, number>();
const pendingDurations = new Map<string, Promise<number>>();

function rememberDuration(abs: string, seconds: number): void {
  durationCache.delete(abs);
  durationCache.set(abs, seconds);
  while (durationCache.size > MAX_DURATION_CACHE) {
    const oldest = durationCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    durationCache.delete(oldest);
  }
}

async function runDurationProbe(abs: string): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      abs,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const [text, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    return 0;
  }
  const duration = Number(text.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

async function loadDuration(abs: string): Promise<number> {
  try {
    const seconds = await runDurationProbe(abs);
    if (seconds > 0) {
      rememberDuration(abs, seconds);
    }
    return seconds;
  } finally {
    pendingDurations.delete(abs);
  }
}

export function probeDuration(abs: string): Promise<number> {
  const cached = durationCache.get(abs);
  if (cached !== undefined) {
    durationCache.delete(abs);
    durationCache.set(abs, cached);
    return Promise.resolve(cached);
  }
  const existing = pendingDurations.get(abs);
  if (existing !== undefined) {
    return existing;
  }
  const pending = loadDuration(abs);
  pendingDurations.set(abs, pending);
  return pending;
}
