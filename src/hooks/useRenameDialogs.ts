import { useCallback, useMemo, useState } from "react";
import { mediaTitle } from "../lib/anilist.ts";
import { planChanges, seasonRenamePlan, type SeasonRenameInput, type SeasonRenamePlan } from "../lib/episodeNames.ts";
import type { SeasonGroup } from "../lib/library.ts";
import type { AniListMedia } from "../types.ts";

export interface DialogToggle {
  readonly open: boolean;
  readonly handleOpen: () => void;
  readonly handleClose: () => void;
}

/** A dialog opened from a menu item; `onOpen` closes the menu. */
export function useDialogToggle(onOpen: () => void): DialogToggle {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => {
    setOpen(true);
    onOpen();
  }, [onOpen]);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);
  return { open, handleOpen, handleClose };
}

export interface SeasonRenameSource {
  readonly enabled: boolean;
  readonly season: SeasonGroup;
  readonly media: AniListMedia | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
}

/** What organizing a season reads from, for admins; undefined for everyone else. */
function useSeasonRenameInput(source: SeasonRenameSource): SeasonRenameInput | undefined {
  const { enabled, season, media, showMedia, seasonNumber } = source;
  return useMemo(() => (enabled ? {
    season, media, showMedia, seasonNumber,
    fallbackTitle: showMedia === undefined ? season.sourceShow : mediaTitle(showMedia),
  } : undefined), [enabled, media, season, seasonNumber, showMedia]);
}

export interface SeasonRename extends DialogToggle {
  /** Null when there's nothing to rename (or the viewer can't). */
  readonly plan: SeasonRenamePlan | null;
}

export function useSeasonRename(source: SeasonRenameSource, onOpen: () => void): SeasonRename {
  const toggle = useDialogToggle(onOpen);
  const input = useSeasonRenameInput(source);
  const plan = useMemo(() => {
    const planned = input === undefined ? null : seasonRenamePlan(input);
    return planned !== null && planChanges(planned) ? planned : null;
  }, [input]);
  return { ...toggle, plan };
}
