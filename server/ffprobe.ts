import { jsonObject, jsonObjects, type JsonObject } from "./json.ts";

interface ProbeOptions {
  readonly input: string;
  readonly selectStreams?: "a" | "s";
  readonly showEntries: string;
}

export async function probeStreams(options: ProbeOptions): Promise<readonly JsonObject[]> {
  const selection = options.selectStreams === undefined
    ? []
    : ["-select_streams", options.selectStreams];
  const process = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    ...selection,
    "-show_entries",
    options.showEntries,
    "-of",
    "json",
    options.input,
  ], { stdout: "pipe", stderr: "ignore" });
  const [text, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    return [];
  }
  const parsed: unknown = JSON.parse(text);
  return jsonObjects(jsonObject(parsed)?.["streams"]);
}
