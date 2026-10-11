import { useCallback, useRef, useState } from "react";
import type { NyaaSearchResult } from "../types.ts";
import { useAddTorrent } from "./useAddTorrent.ts";

interface DownloadState {
  readonly status: "pending" | "success" | "error";
  readonly error?: string;
}

function downloadQueue(results: readonly NyaaSearchResult[], available: (result: NyaaSearchResult) => boolean): NyaaSearchResult[] {
  const unique = new Map<string, NyaaSearchResult>();
  for (const result of results) {
    if (available(result)) {
      unique.set(result.magnet, result);
    }
  }
  return [...unique.values()];
}

export function useNyaaDownloads(showFolder: string) {
  const addTorrent = useAddTorrent();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [downloads, setDownloads] = useState<ReadonlyMap<string, DownloadState>>(new Map());
  const active = useRef(false);
  const states = useRef(new Map<string, DownloadState>());
  const available = useCallback((result: NyaaSearchResult) => {
    const status = states.current.get(result.magnet)?.status;
    return status !== "pending" && status !== "success";
  }, []);
  const select = useCallback((magnet: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(magnet);
      } else {
        next.delete(magnet);
      }
      return next;
    });
  }, []);
  const selectAll = useCallback((results: readonly NyaaSearchResult[], checked: boolean) => {
    const magnets = new Set<string>();
    if (checked) {
      for (const result of results) {
        if (available(result)) {
          magnets.add(result.magnet);
        }
      }
    }
    setSelected(magnets);
  }, [available]);
  const download = useCallback(async (results: readonly NyaaSearchResult[]) => {
    const queue = downloadQueue(results, available);
    if (active.current || queue.length === 0) {
      return;
    }
    active.current = true;
    const update = (magnet: string, state: DownloadState) => {
      states.current.set(magnet, state);
      setDownloads(new Map(states.current));
    };
    for (const result of queue) {
      update(result.magnet, { status: "pending" });
    }
    const worker = async (): Promise<void> => {
      const result = queue.shift();
      if (result === undefined) {
        return;
      }
      try {
        await addTorrent.mutateAsync({ file: null, magnet: result.magnet, showFolder });
        update(result.magnet, { status: "success" });
        select(result.magnet, false);
      } catch (error: unknown) {
        update(result.magnet, { status: "error", error: error instanceof Error ? error.message : "Could not add torrent." });
      }
      await worker();
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    active.current = false;
  }, [addTorrent, available, select, showFolder]);
  return { selected, downloads, pending: [...downloads.values()].some((state) => state.status === "pending"), available, select, selectAll, download };
}
