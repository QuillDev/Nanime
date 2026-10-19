import { useMemo } from "react";
import { buildProfileEpisodes, type ProfileEpisodes } from "../lib/profileMedia.ts";
import type { ShowMetadata } from "../types.ts";
import { useLibrary } from "./useLibrary.ts";
import { useShowMetadata } from "./useShowMetadata.ts";

const NO_ENTRIES: readonly [] = [];
const NO_METADATA: ShowMetadata = {};

/** Library files keyed by path with show names, episode numbers and artwork for the profile page. */
export function useProfileEpisodes(): ProfileEpisodes {
  const library = useLibrary();
  const metadata = useShowMetadata();
  const entries = library.data ?? NO_ENTRIES;
  const shows = metadata.data ?? NO_METADATA;
  return useMemo(() => buildProfileEpisodes(entries, shows), [entries, shows]);
}
