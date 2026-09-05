import { expect, test } from "bun:test";
import { partyIdFromInvite } from "./partyInvite.ts";

test("joining accepts local invite links and rejects foreign or malformed invitations", () => {
  const origin = "https://media.example";
  const id = "a".repeat(32);
  expect(partyIdFromInvite(`  ${origin}/?watch=${id}  `, origin)).toBe(id);
  expect(partyIdFromInvite(`/?watch=${id}`, origin)).toBe(id);
  expect(partyIdFromInvite(`https://other.example/?watch=${id}`, origin)).toBeNull();
  expect(partyIdFromInvite(`${origin}/?watch=invalid`, origin)).toBeNull();
  expect(partyIdFromInvite("data:text/plain,invalid", origin)).toBeNull();
  expect(partyIdFromInvite("", origin)).toBeNull();
});
