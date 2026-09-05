import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../api.ts";
import { navigateToWatchEpisode, leaveWatchTogether, useMediaRoute } from "./useMediaRoute.ts";
import { newPartyCredentials, restorePartyMembership, savePartyMembership, type PartyMembership } from "../lib/partyMembership.ts";
import { usePartyBroadcast, usePartyPresence } from "./usePartyConnection.ts";

export interface WatchTogetherPlayer {
  readonly rel: string;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
  readonly onSeek: (position: number) => void;
}
function useSessionPlayer(rel: string | null) {
  const playerRef = useRef<WatchTogetherPlayer | null>(null);
  const readPlayback = useCallback(() => {
    const player = playerRef.current;
    const video = player?.videoRef.current;
    if (video === undefined || video === null || player === null || player.rel !== rel) {
      return { rel: null, position: 0, paused: true, rate: 1 };
    }
    return { rel: player.rel, position: player.playbackPosition(video), paused: video.paused || video.ended || video.readyState < 3 || video.seeking, rate: video.playbackRate };
  }, [rel]);
  const attachPlayer = useCallback((player: WatchTogetherPlayer) => {
    playerRef.current = player;
    return () => { if (playerRef.current === player) { playerRef.current = null; } };
  }, []);
  return { readPlayback, attachPlayer };
}
function useMembership(userId: number, invite: string | null) {
  const [member, setMember] = useState(() => restorePartyMembership(userId, invite));
  const remember = useCallback((next: PartyMembership | null) => {
    savePartyMembership(userId, next);
    setMember(next);
  }, [userId]);
  return { member, remember };
}
function usePartyActions(membership: ReturnType<typeof useMembership>, readPlayback: ReturnType<typeof useSessionPlayer>["readPlayback"]) {
  const client = useQueryClient();
  const { member, remember } = membership;
  const start = useMutation({
    mutationFn: async () => {
      const current = readPlayback();
      const credentials = newPartyCredentials();
      const created = unwrap(await api.api["watch-together"].post({ ...current, rel: current.rel, member: credentials }), "Starting watch together");
      return { id: created.id, ...credentials };
    },
    onSuccess: async (created) => { remember(created); await client.invalidateQueries({ queryKey: ["party"] }); },
  });
  const join = useMutation({
    mutationFn: async (id: string) => {
      const next = { id, ...newPartyCredentials() };
      unwrap(await api.api["watch-together"]({ id }).presence.post(next), "Joining party");
      return next;
    },
    onSuccess: async (next) => {
      remember(next);
      navigateToWatchEpisode(next.id, null);
      await client.invalidateQueries({ queryKey: ["party"] });
    },
  });
  const handleLeave = useCallback(() => {
    remember(null);
    leaveWatchTogether();
    if (member !== null) { void api.api["watch-together"]({ id: member.id }).leave.post(member, { fetch: { keepalive: true } }); }
  }, [member, remember]);
  const end = useMutation({
    mutationFn: async (generation: number) => {
      if (member !== null) { unwrap(await api.api["watch-together"]({ id: member.id }).end.post({ ...member, generation }), "Ending party"); }
    },
    onSuccess: async () => { remember(null); leaveWatchTogether(); await client.invalidateQueries({ queryKey: ["party"] }); },
  });
  return { start, join, end, handleLeave };
}
function usePartyLeadership(member: PartyMembership | null, presence: ReturnType<typeof usePartyPresence>) {
  const route = useMediaRoute();
  const state = presence.data?.state;
  const leading = state?.isHost === true && presence.ready && !presence.isError;
  useEffect(() => {
    if (member === null || state === undefined || leading || presence.isError) { return; }
    if (route.episodeRel !== state.rel || route.watchTogether !== member.id || route.admin || route.profile) {
      navigateToWatchEpisode(member.id, state.rel);
    }
  }, [member, state, leading, presence.isError, route.episodeRel, route.watchTogether, route.admin, route.profile]);
  return { leading, markReady: presence.markReady, generation: leading ? state.generation : null };
}

function usePartyRemoval(member: PartyMembership | null, generation: number | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      if (member === null || generation === null) { throw new Error("Only the host can remove members."); }
      unwrap(await api.api["watch-together"]({ id: member.id }).remove.post({ ...member, generation, memberId }), "Removing party member");
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["party"] }); },
  });
}

export function useWatchTogetherSession(userId: number) {
  const route = useMediaRoute();
  const membership = useMembership(userId, route.watchTogether);
  const player = useSessionPlayer(route.episodeRel);
  const presence = usePartyPresence(membership.member);
  const leadership = usePartyLeadership(membership.member, presence);
  const broadcastError = usePartyBroadcast(membership.member, leadership.generation, player.readPlayback);
  const actions = usePartyActions(membership, player.readPlayback);
  const remove = usePartyRemoval(membership.member, leadership.generation);
  const handleEnd = useCallback(() => {
    if (leadership.generation !== null) { actions.end.mutate(leadership.generation); }
  }, [actions.end, leadership.generation]);
  return {
    host: leadership.leading ? membership.member : null,
    guestId: leadership.leading ? null : membership.member?.id ?? null,
    ...actions, remove, handleEnd, attachPlayer: player.attachPlayer, markReady: leadership.markReady,
    snapshot: presence.data, error: actions.start.error ?? actions.join.error ?? actions.end.error ?? remove.error ?? presence.error ?? (leadership.leading ? broadcastError : null),
    joining: membership.member !== null && presence.isPending,
    waiting: membership.member !== null && presence.data?.state.rel === null,
  };
}
