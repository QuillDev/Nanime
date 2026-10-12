export { captureEncoder, captureProbe } from "./transcodeProcessLifetime.ts";

interface ProgressSample {
  readonly progress: number;
  readonly speed: number;
}

function speedValue(value: string): number {
  const speed = Number(value.replace(/x$/u, ""));
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

export async function readTranscodeProgress(
  stream: ReadableStream<Uint8Array>,
  durationSeconds: number,
  onProgress: (sample: ProgressSample) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputSeconds = 0;
  let speed = 0;
  let lastUpdate = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1).trim();
      if (key === "out_time_us") {
        outputSeconds = Number(value) / 1_000_000;
      } else if (key === "speed") {
        speed = speedValue(value);
      }
    }
    const now = Date.now();
    if (now - lastUpdate >= 1000 && durationSeconds > 0) {
      onProgress({ progress: Math.min(0.999, outputSeconds / durationSeconds), speed });
      lastUpdate = now;
    }
  }
}
