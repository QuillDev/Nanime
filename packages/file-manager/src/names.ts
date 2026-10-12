import { findLock, type FoundLock, type LockResolver } from "./locks.js";
import { childrenOf, type TreeIndex } from "./model.js";
import type { FileItem } from "./types.js";

export type IssueCode =
  | "missing"
  | "invalid-name"
  | "extension-change"
  | "collision"
  | "self"
  | "descendant"
  | "not-folder"
  | "same-location"
  | "locked";

export interface Issue {
  readonly code: IssueCode;
  readonly message: string;
  readonly id?: string;
}

export interface NameParts {
  readonly stem: string;
  readonly extension: string;
}

/** Trailing `findSibling` arguments: the name to look for and an item to ignore. */
export type SiblingQuery = readonly [name: string, exceptId?: string];

/** Trailing `validateRename` arguments: the proposed name and the host lock policy. */
export type RenameQuery<M> = readonly [name: string, resolve?: LockResolver<M>];

export function splitExtension(name: string): NameParts {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, extension: "" };
  }
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

const RESERVED_CHARACTERS: ReadonlySet<string> = new Set(["\\", "/", ":", "*", "?", "\"", "<", ">", "|"]);

/** Describes the first character a filesystem would refuse, in reading order. */
function forbiddenCharacter(name: string): string | null {
  for (const character of name) {
    if ((character.codePointAt(0) ?? 0) < 32) {
      return "control characters";
    }
    if (RESERVED_CHARACTERS.has(character)) {
      return `"${character}"`;
    }
  }
  return null;
}

function forbiddenCharacterMessage(name: string): string | null {
  const shown = forbiddenCharacter(name);
  return shown === null ? null : `Name can't contain ${shown}.`;
}

const NAME_RULES: readonly ((name: string) => string | null)[] = [
  (name) => (name.trim() === "" ? "Name can't be empty." : null),
  (name) => (name === name.trim() ? null : "Name can't start or end with a space."),
  (name) => (name === "." || name === ".." ? `"${name}" is reserved.` : null),
  (name) => (name.endsWith(".") ? "Name can't end with a dot." : null),
  forbiddenCharacterMessage,
  (name) => (name.length > 255 ? "Name is longer than 255 characters." : null),
];

export function validateName(name: string): Issue | null {
  for (const rule of NAME_RULES) {
    const message = rule(name);
    if (message !== null) {
      return { code: "invalid-name", message };
    }
  }
  return null;
}

function sameName<M>(index: TreeIndex<M>, a: string, b: string): boolean {
  return index.caseSensitive ? a === b : a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function findSibling<M>(index: TreeIndex<M>, parentId: string | null, ...[name, exceptId]: SiblingQuery): FileItem<M> | undefined {
  return childrenOf(index, parentId).find((node) => node.id !== exceptId && sameName(index, node.name, name));
}

export function lockIssue<M>(found: FoundLock<M>): Issue {
  return { code: "locked", message: found.lock.reason, id: found.item.id };
}

function parentIssue<M>(index: TreeIndex<M>, parentId: string | null): Issue | null {
  if (parentId === null) {
    return null;
  }
  const parent = index.byId.get(parentId);
  if (parent === undefined) {
    return { code: "missing", message: "That folder no longer exists." };
  }
  return parent.kind === "folder" ? null : { code: "not-folder", message: "Folders can only be created inside folders." };
}

export function validateCreateFolder<M>(index: TreeIndex<M>, parentId: string | null, name: string): Issue | null {
  const issue = parentIssue(index, parentId) ?? validateName(name);
  if (issue !== null) {
    return issue;
  }
  const clash = findSibling(index, parentId, name);
  return clash === undefined ? null : { code: "collision", message: `"${clash.name}" already exists here.`, id: clash.id };
}

function extensionIssue<M>(item: FileItem<M>, name: string): Issue | null {
  if (item.kind !== "file") {
    return null;
  }
  const before = splitExtension(item.name).extension;
  const after = splitExtension(name).extension;
  if (before.toLocaleLowerCase() === after.toLocaleLowerCase()) {
    return null;
  }
  return { code: "extension-change", message: before === "" ? "Renaming can't add a file extension." : `Keep the ${before} extension.` };
}

export function validateRename<M>(index: TreeIndex<M>, id: string, ...[name, resolve]: RenameQuery<M>): Issue | null {
  const item = index.byId.get(id);
  if (item === undefined) {
    return { code: "missing", message: "That item no longer exists." };
  }
  const found = findLock(index, [id], "rename", resolve);
  const issue = found === null ? validateName(name) ?? extensionIssue(item, name) : lockIssue(found);
  if (issue !== null) {
    return issue;
  }
  const clash = findSibling(index, item.parentId, name, id);
  return clash === undefined ? null : { code: "collision", message: `"${clash.name}" already exists in this folder.`, id: clash.id };
}
