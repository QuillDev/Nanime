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

export class HlsStoppingCapacity {
  private global = 0;
  private readonly users = new Map<number, number>();

  count(userId?: number): number {
    return userId === undefined ? this.global : (this.users.get(userId) ?? 0);
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
    };
  }
}
