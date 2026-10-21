/** The viewer's choice to always watch the converted (H.264) stream instead of the original video. */
const CONVERTED_STREAM_KEY = "nanime.converted-stream";

export function convertedStreamPreferred(): boolean {
  try {
    return localStorage.getItem(CONVERTED_STREAM_KEY) === "1";
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
