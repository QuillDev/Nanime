export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "The operation failed. Nothing was changed.";
}
