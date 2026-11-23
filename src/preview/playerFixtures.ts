import type { QueryClient } from "@tanstack/react-query";
import type { AudioTrack, SubtitleTrack } from "../types.ts";

const SUBTITLES: readonly SubtitleTrack[] = [
  { index: 2, codec: "ass", language: "eng", label: "English", sizeBytes: null },
  { index: 3, codec: "ass", language: "eng", label: "English (signs & songs)", sizeBytes: null },
  { index: 4, codec: "ass", language: "spa", label: "Spanish (Latin America) [Full subtitles with honorifics]", sizeBytes: null },
];
const AUDIO: readonly AudioTrack[] = [
  { index: 1, codec: "aac", language: "jpn", label: "Japanese", channels: 2, isDefault: true, sizeBytes: null },
  { index: 5, codec: "aac", language: "eng", label: "English", channels: 2, isDefault: false, sizeBytes: null },
];

function click(selector: string, text?: string): void {
  const matches = [...document.querySelectorAll<HTMLElement>(selector)];
  (text === undefined ? matches[0] : matches.find((match) => match.textContent.trim().startsWith(text)))?.click();
}

// What each "player-…" state opens once the player is up: a bottom or top button, then a control inside its panel.
const OPENED = new Map<string, readonly (readonly [string, string?])[]>([
  ["player-episodes", [["button[aria-label='Episodes']"]]],
  ["player-tracks", [["button[aria-label='Audio & subtitles']"]]],
  ["player-subtitles", [["button[aria-label='Audio & subtitles']"], ["[data-player-panel] button", "Subtitles"]]],
  ["player-party-start", [["button[aria-label='Watch together']"]]],
  ["player-party", [["button[aria-label='Watch together']"]]],
  ["player-party-crowded", [["button[aria-label='Watch together']"]]],
  ["player-party-leave", [["button[aria-label='Watch together']"], ["[data-player-panel] button", "Leave"]]],
]);

/** Streams never load in the preview: without a server they would fail and cover the player with an error. */
function stallStreams(): void {
  const { send: realSend, open: realOpen } = XMLHttpRequest.prototype;
  const stalled = new WeakSet<XMLHttpRequest>();
  XMLHttpRequest.prototype.open = function open(this: XMLHttpRequest, ...args: Parameters<typeof realOpen>): void {
    if (String(args[1]).includes("/hls/")) {
      stalled.add(this);
    }
    realOpen.apply(this, args);
  } as typeof realOpen;
  XMLHttpRequest.prototype.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    if (!stalled.has(this)) {
      realSend.call(this, body);
    }
  };
}

/** "player" and its panel states: tracks to choose from, a stream that never answers, and the panel opened. */
export function seedPlayer(client: QueryClient, state: string, rels: readonly string[]): void {
  if (!state.startsWith("player")) {
    return;
  }
  stallStreams();
  for (const rel of rels) {
    client.setQueryData(["subtitle-tracks", rel], SUBTITLES);
    client.setQueryData(["audio-tracks", rel], AUDIO);
  }
  const [first, second] = OPENED.get(state) ?? [];
  setTimeout(() => {
    if (first !== undefined) {
      click(...first);
    }
    setTimeout(() => {
      if (second !== undefined) {
        click(...second);
      }
    }, 150);
  }, 500);
}
