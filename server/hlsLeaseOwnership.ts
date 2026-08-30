export function hlsOwnershipKey(userId: number, id: string): string {
  return `${String(userId)}\0${id}`;
}

export async function supersedeHlsLease(
  options: {
    readonly owners: Map<string, string>;
    readonly owner: string;
    readonly leaseId: string;
    readonly release: (leaseId: string) => Promise<void>;
  },
): Promise<boolean> {
  const { owners, owner, leaseId, release } = options;
  const previous = owners.get(owner);
  owners.set(owner, leaseId);
  if (previous !== undefined && previous !== leaseId) {
    await release(previous);
  }
  return owners.get(owner) === leaseId;
}
