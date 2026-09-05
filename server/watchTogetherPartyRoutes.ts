import type { PartyMemberCredentials } from "../shared/watchTogether.ts";
import { Value } from "@sinclair/typebox/value";
import { endParty, removePartyMember, leaveParty, partyPlayback, partyPresence } from "./watchTogetherMembers.ts";
import { partyRemoveSchema, partyEndSchema, partyMemberSchema, partyPlaybackSchema } from "./watchTogetherSchemas.ts";

const check = Value.Check;
interface Context {
  readonly req: Request;
  readonly user: { readonly id: number };
}
function actor(context: Context, id: string, member: PartyMemberCredentials) {
  return { ...member, id, userId: context.user.id };
}
async function handleParty(context: Context, route: { readonly id: string; readonly action: string }, mediaExists: (rel: string) => Promise<boolean>): Promise<Response> {
  const body: unknown = await context.req.json().catch(() => null);
  const { method } = context.req;
  switch (`${method} ${route.action}`) {
    case "POST presence": {
      if (!check(partyMemberSchema, body)) { return new Response("Invalid request", { status: 400 }); }
      const state = partyPresence(actor(context, route.id, body));
      return state === null ? new Response("Party unavailable or this tab has been replaced", { status: 410 }) : Response.json(state);
    }
    case "POST leave": {
      if (!check(partyMemberSchema, body)) { return new Response("Invalid request", { status: 400 }); }
      return Response.json({ left: leaveParty(actor(context, route.id, body)) });
    }
    case "POST remove": {
      if (!check(partyRemoveSchema, body)) { return new Response("Invalid request", { status: 400 }); }
      return removePartyMember(actor(context, route.id, body), body)
        ? Response.json({ removed: true }) : new Response("Only the current host can remove another party member", { status: 403 });
    }
    case "POST end": {
      if (!check(partyEndSchema, body)) { return new Response("Invalid request", { status: 400 }); }
      return endParty(actor(context, route.id, body), body.generation) ? Response.json({ ended: true }) : new Response("Host authority changed", { status: 403 });
    }
    case "PUT party-playback": { return updatePlayback({ context, id: route.id, body }, mediaExists); }
    default: { return new Response("Method not allowed", { status: 405 }); }
  }
}

async function updatePlayback(request: { readonly context: Context; readonly id: string; readonly body: unknown }, mediaExists: (rel: string) => Promise<boolean>): Promise<Response> {
  const { context, id, body } = request;
  if (!check(partyPlaybackSchema, body)) { return new Response("Invalid request", { status: 400 }); }
  if (body.rel !== null && !await mediaExists(body.rel)) { return new Response("Not found", { status: 404 }); }
  const state = partyPlayback(actor(context, id, body), body);
  return state === null ? new Response("Host authority changed", { status: 409 }) : Response.json(state);
}

export async function watchTogetherPartyRoute(context: Context, route: { readonly id: string; readonly action: string }, mediaExists: (rel: string) => Promise<boolean>): Promise<Response> {
  const response = await handleParty(context, route, mediaExists);
  response.headers.set("cache-control", "no-store");
  return response;
}
