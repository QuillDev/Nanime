import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../api.ts";
import type { PartyMembership } from "../lib/partyMembership.ts";
import type { PartyState } from "../../shared/watchTogether.ts";

export interface PartySnapshot { readonly state: PartyState; readonly receivedAt: number; readonly latency: number }
export interface PartyPlayback { readonly rel: string | null; readonly position: number; readonly paused: boolean; readonly rate: number }
function newest(previous: PartySnapshot | undefined, next: PartySnapshot): PartySnapshot {
  if (previous !== undefined && (previous.state.generation > next.state.generation || previous.state.serverTime > next.state.serverTime)) { return previous; }
  return next;
}
function connectionKey(member: PartyMembership | null) { return ["party", member?.id, member?.connectionId] as const; }
export function usePartyPresence(member: PartyMembership | null) {
  const client = useQueryClient();
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const markReady = useCallback((generation: number) => setReadyKey(
    `${member?.connectionId ?? ""}:${String(generation)}`,
  ), [member?.connectionId]);
  const query = useQuery({
    queryKey: connectionKey(member), enabled: member !== null,
    queryFn: async ({ signal }) => {
      if (member === null) { throw new Error("No party selected"); }
      const started = performance.now();
      const state = unwrap(await api.api["watch-together"]({ id: member.id }).presence.post(member, { fetch: { signal, cache: "no-store" } }), "Restoring party");
      if (state.isHost && state.rel === null) { markReady(state.generation); }
      return newest(client.getQueryData<PartySnapshot>(connectionKey(member)), { state, receivedAt: performance.now(), latency: (performance.now() - started) / 2 });
    },
    refetchInterval: 500, refetchIntervalInBackground: true, retry: false, gcTime: 0,
  });
  return { ...query, markReady, ready: readyKey === `${member?.connectionId ?? ""}:${String(query.data?.state.generation)}` };
}
export function usePartyBroadcast(member: PartyMembership | null, generation: number | null, readPlayback: () => PartyPlayback) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (member === null || generation === null) { return undefined; }
      return unwrap(await api.api["watch-together"]({ id: member.id })["party-playback"].put({ ...member, generation, ...readPlayback() }), "Sharing playback");
    },
    onSuccess: (state) => {
      if (state !== undefined) {
        client.setQueryData<PartySnapshot>(connectionKey(member), (previous) => newest(previous, { state, receivedAt: performance.now(), latency: 0 }));
      }
    },
  });
  const { mutateAsync } = mutation;
  useEffect(() => {
    if (member === null || generation === null) { return; }
    let busy = false;
    const broadcast = async (): Promise<void> => {
      if (busy) { return; }
      busy = true;
      try { await mutateAsync(); }
      catch {
        // Presence refreshes authoritative host ownership after a handoff.
      } finally { busy = false; }
    };
    const timer = globalThis.setInterval(broadcast, 500);
    return () => globalThis.clearInterval(timer);
  }, [member, generation, mutateAsync]);
  return mutation.error;
}
