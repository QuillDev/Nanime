export interface WatchTogetherState {
  readonly id: string;
  readonly rel: string | null;
  readonly position: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly updatedAt: number;
  readonly serverTime: number;
}

export const WATCH_TOGETHER_TIMEOUT = 15_000;

export function watchTogetherPosition(state: WatchTogetherState, elapsed: number): number {
  const age = Math.max(0, state.serverTime - state.updatedAt + elapsed);
  return state.position + (state.paused ? 0 : Math.min(age, WATCH_TOGETHER_TIMEOUT) / 1000 * state.rate);
}

export const PARTY_HOST_GRACE = 30_000;
export const PARTY_IDLE_TIMEOUT = 24 * 60 * 60 * 1000;

export interface PartyMemberCredentials {
  readonly memberToken: string;
  readonly connectionId: string;
  readonly incarnation: number;
}

export interface PartyMember {
  readonly id: string;
  readonly name: string;
  readonly isHost: boolean;
  readonly isSelf: boolean;
}

export interface PartyState extends WatchTogetherState {
  readonly isHost: boolean;
  readonly generation: number;
  readonly hostName: string | null;
  readonly members: number;
  readonly memberList: readonly PartyMember[];
}
