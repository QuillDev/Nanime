/**
 * Organized library names: `003. Season Title` for a season folder and
 * `001. Episode Title.mkv` for an episode. The number orders the item and the
 * text after it is what Nanime shows, so names read on disk exactly as they
 * do in the app.
 */

export interface NumberedName {
  readonly number: number;
  readonly title: string;
}

const NUMBERED = /^(?<number>\d{1,4})\.\s+(?<title>\S.*)$/u;
const PAD = 3;

/** The number and title of `NNN. Title` (pass file names without their extension). */
export function parseNumberedName(name: string): NumberedName | null {
  const groups = NUMBERED.exec(name)?.groups;
  const number = groups?.["number"];
  const title = groups?.["title"]?.trim();
  return number === undefined || title === undefined || title === "" ? null : { number: Number(number), title };
}

/** Characters a single path segment can't hold, plus whitespace runs. */
function cleanTitle(title: string): string {
  return title.replaceAll(/[/\\]+/gu, "-").replaceAll(/\s+/gu, " ").trim().replace(/[. ]+$/u, "");
}

/** `NNN. Title`, or null when the title has nothing usable left. */
export function numberedName(number: number, title: string): string | null {
  const clean = cleanTitle(title);
  return clean === "" ? null : `${String(number).padStart(PAD, "0")}. ${clean}`;
}
