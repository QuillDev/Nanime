type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export function jsonObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

export function jsonObjects(value: unknown): readonly JsonObject[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const object = jsonObject(item);
        return object === null ? [] : [object];
      })
    : [];
}
