import { streamChoiceEnabled } from "./streamChoicePreference.ts";

/** The viewer's choice to always watch the converted (H.264) stream instead of the original video. */
const CONVERTED_STREAM_KEY = "nanime.converted-stream";

/** Only while the stream choice is turned on in the profile; otherwise playback is as normal. */
export function convertedStreamPreferred(): boolean {
  try {
    return streamChoiceEnabled() && localStorage.getItem(CONVERTED_STREAM_KEY) === "1";
  } catch {
    return false;
  }
}

export function setConvertedStreamPreferred(converted: boolean): void {
  try {
    if (converted) {
      localStorage.setItem(CONVERTED_STREAM_KEY, "1");
    } else {
      localStorage.removeItem(CONVERTED_STREAM_KEY);
    }
  } catch {
    // Storage may be off; the choice then lasts until the player closes.
  }
}
