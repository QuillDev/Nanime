export interface HlsCapacityState {
  readonly activeGlobal: number;
  readonly activeUser: number;
  readonly maxGlobal: number;
  readonly maxUser: number;
  readonly pendingGlobal: number;
  readonly pendingUser: number;
}

export function hlsCapacityAvailable(state: HlsCapacityState): boolean {
  return state.activeGlobal + state.pendingGlobal < state.maxGlobal &&
    state.activeUser + state.pendingUser < state.maxUser;
}

interface LegacyHlsSession {
  readonly lastAccess: number;
  readonly legacyAccess: boolean;
  readonly userId: number;
}

export function oldestLegacyHlsSession<T extends LegacyHlsSession>(
  sessions: Iterable<T>,
  userId: number,
): T | undefined {
  return [...sessions].filter((session) => (
    session.legacyAccess && session.userId === userId
  )).toSorted((left, right) => left.lastAccess - right.lastAccess)[0];
}

interface ReserveHlsPlaybackOptions<T extends LegacyHlsSession> {
  readonly managed: boolean;
  readonly reclaim: (session: T) => Promise<void>;
  readonly sessions: () => Iterable<T>;
  readonly tryReserve: () => boolean;
  readonly userId: number;
  readonly waitForStopping: () => Promise<boolean>;
}

export async function reserveHlsPlaybackCapacity<T extends LegacyHlsSession>(
  options: ReserveHlsPlaybackOptions<T>,
): Promise<boolean> {
  if (!options.managed) {
    const legacy = oldestLegacyHlsSession(options.sessions(), options.userId);
    if (legacy !== undefined) {
      await options.reclaim(legacy);
      return reserveHlsPlaybackCapacity(options);
    }
  }
  if (options.tryReserve()) {
    return true;
  }
  if (await options.waitForStopping()) {
    return reserveHlsPlaybackCapacity(options);
  }
  return false;
}

export class HlsStoppingCapacity {
  private global = 0;
  private readonly users = new Map<number, number>();
  private readonly waiters = new Set<(changed: boolean) => void>();

  count(userId?: number): number {
    return userId === undefined ? this.global : (this.users.get(userId) ?? 0);
  }

  waitForChange(): Promise<boolean> {
    if (this.global === 0) {
      return Promise.resolve(false);
    }
    const waiter = Promise.withResolvers<boolean>();
    this.waiters.add(waiter.resolve);
    return waiter.promise;
  }

  begin(userId: number): () => void {
    this.global += 1;
    this.users.set(userId, (this.users.get(userId) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.global = Math.max(0, this.global - 1);
      const remaining = Math.max(0, (this.users.get(userId) ?? 1) - 1);
      if (remaining === 0) {
        this.users.delete(userId);
      } else {
        this.users.set(userId, remaining);
      }
      for (const resolve of this.waiters) {
        resolve(true);
      }
      this.waiters.clear();
    };
  }
}
