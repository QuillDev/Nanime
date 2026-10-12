import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { flattenFolders, matchingFolders, toggledSet, type FolderRow } from "./folders.js";
import type { LockResolver } from "./locks.js";
import { ancestorsOf, isDescendantOf, pathOf, topLevelIds, type TreeIndex } from "./model.js";
import { planMove, type MovePlan } from "./moves.js";

/** Chosen destination folder: `null` is the root, `undefined` means none picked yet. */
export type Destination = string | null | undefined;

export interface MoveDraftInput<M> {
  readonly index: TreeIndex<M>;
  readonly ids: readonly string[];
  readonly currentFolderId: string | null;
  readonly rootLabel: string;
  readonly lockOf: LockResolver<M>;
}

function initiallyExpanded<M>(index: TreeIndex<M>, currentFolderId: string | null): Set<string> {
  const path = ancestorsOf(index, currentFolderId).map((node) => node.id);
  return new Set(currentFolderId === null ? path : [...path, currentFolderId]);
}

/** Why a folder can't take the selection, or null when it can. */
function blockedReason<M>(index: TreeIndex<M>, moving: readonly string[], folderId: string | null): string | null {
  if (folderId !== null && moving.includes(folderId)) {
    return "Selected";
  }
  if (folderId !== null && moving.some((id) => isDescendantOf(index, folderId, id))) {
    return "Inside selection";
  }
  if (moving.length > 0 && moving.every((id) => index.byId.get(id)?.parentId === folderId)) {
    return "Current location";
  }
  return null;
}

function destinationName<M>(index: TreeIndex<M>, target: string | null, rootLabel: string): string {
  return target === null ? rootLabel : index.byId.get(target)?.name ?? "";
}

/** Where the moving items come from: one folder path, or how many folders. */
function sourceLabel<M>(index: TreeIndex<M>, moving: readonly string[], rootLabel: string): string {
  const sources = new Set(moving.map((id) => index.byId.get(id)?.parentId ?? null));
  const [only = null] = sources;
  return sources.size === 1 ? pathOf(index, only, rootLabel) : `${sources.size} folders`;
}

/** Destination picker state: chosen folder, search, expanded folders and left-out items. */
function useDraftState<M>(index: TreeIndex<M>, currentFolderId: string | null) {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [target, setTarget] = useState<Destination>(undefined);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => initiallyExpanded(index, currentFolderId));
  const leaveOut = useCallback((id: string) => setExcluded((current) => new Set([...current, id])), []);
  const putBack = useCallback(() => setExcluded(new Set()), []);
  const onQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), []);
  const toggle = useCallback((id: string) => setExpanded((current) => toggledSet(current, id)), []);
  return { excluded, leaveOut, putBack, target, pick: setTarget, query, onQuery, expanded, toggle };
}

export interface MoveView<M> {
  readonly moving: readonly string[];
  readonly plan: MovePlan<M> | null;
  /** Lower-cased folder search; empty shows the expandable tree. */
  readonly needle: string;
  readonly rows: readonly FolderRow<M>[];
  readonly targetLabel: string;
  readonly fromLabel: string;
  readonly reasonFor: (folderId: string | null) => string | null;
}

/** Draft of a move: what moves where, and whether the plan holds. */
export function useMoveDraft<M>({ index, ids, currentFolderId, rootLabel, lockOf }: MoveDraftInput<M>) {
  const draft = useDraftState(index, currentFolderId);
  const { excluded, target, query, expanded } = draft;
  const moving = useMemo(() => topLevelIds(index, ids).filter((id) => !excluded.has(id)), [index, ids, excluded]);
  const needle = query.trim().toLocaleLowerCase();
  const view = useMemo<MoveView<M>>(() => ({
    moving,
    plan: target === undefined ? null : planMove(index, moving, target, lockOf),
    needle,
    rows: needle === "" ? flattenFolders(index, expanded) : matchingFolders(index, needle),
    targetLabel: target === undefined ? "" : destinationName(index, target, rootLabel),
    fromLabel: sourceLabel(index, moving, rootLabel),
    reasonFor: (folderId) => blockedReason(index, moving, folderId),
  }), [index, moving, target, lockOf, needle, expanded, rootLabel]);
  return { ...draft, ...view };
}

export type MoveDraft<M> = ReturnType<typeof useMoveDraft<M>>;
