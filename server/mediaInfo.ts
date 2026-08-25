const durationCache = new Map<string, number>();

export async function probeDuration(abs: string): Promise<number> {
  const cached = durationCache.get(abs);
  if (cached !== undefined) {
    return cached;
  }
  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      abs,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const text = await new Response(proc.stdout).text();
  const duration = Number(text.trim());
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 0;
  durationCache.set(abs, seconds);
  return seconds;
}
