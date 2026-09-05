import { watchTogetherPartyRoute } from "./watchTogetherPartyRoutes.ts";
import { Value } from "@sinclair/typebox/value";
import { createWatchTogether, endWatchTogether, getWatchTogether, updateWatchTogether } from "./watchTogether.ts";
import { watchCreateSchema, watchEndSchema, watchUpdateSchema } from "./watchTogetherSchemas.ts";

const check = Value.Check;

interface Context {
  readonly pathname: string;
  readonly req: Request;
  readonly user: { readonly id: number };
}

async function create(req: Request, userId: number, mediaExists: (rel: string) => Promise<boolean>): Promise<Response> {
  const body: unknown = await req.json();
  if (!check(watchCreateSchema, body)) {
    return new Response("Invalid request", { status: 400 });
  }
  if (body.rel !== null && !await mediaExists(body.rel)) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json(createWatchTogether(userId, body.rel ?? "", body), { headers: { "cache-control": "no-store" } });
}

async function mutate(context: Context, id: string, mediaExists: (rel: string) => Promise<boolean>): Promise<Response> {
  const { req, user: { id: userId } } = context;
  const body: unknown = await req.json();
  if (req.method === "PUT" && check(watchUpdateSchema, body)) {
    if (body.rel !== undefined && body.rel !== null && !await mediaExists(body.rel)) {
      return new Response("Not found", { status: 404 });
    }
    return updateWatchTogether({ id, userId, hostToken: body.hostToken, playback: body })
      ? Response.json(getWatchTogether(id)) : new Response("Session unavailable", { status: 403 });
  }
  if (req.method === "DELETE" && check(watchEndSchema, body)) {
    return endWatchTogether(id, userId, body.hostToken)
      ? Response.json({ ended: true }) : new Response("Session unavailable", { status: 403 });
  }
  return new Response("Invalid request", { status: 400 });
}

export function watchTogetherRoute(
  context: Context, mediaExists: (rel: string) => Promise<boolean>,
): Response | Promise<Response> | null {
  const { pathname, req, user } = context;
  if (pathname === "/api/watch-together" && req.method === "POST") {
    return create(req, user.id, mediaExists);
  }
  const party = /^\/api\/watch-together\/(?<id>[\w-]{32})\/(?<action>presence|leave|end|remove|party-playback)$/u.exec(pathname)?.groups;
  if (party?.["id"] !== undefined && party["action"] !== undefined) {
    return watchTogetherPartyRoute(context, { id: party["id"], action: party["action"] }, mediaExists);
  }
  const match = /^\/api\/watch-together\/(?<id>[\w-]{32})$/u.exec(pathname);
  const id = match?.groups?.["id"];
  if (id === undefined) {
    return null;
  }
  if (req.method === "GET") {
    const room = getWatchTogether(id);
    return room === null ? new Response("Session ended or host disconnected", { status: 410 }) : Response.json(room, { headers: { "cache-control": "no-store" } });
  }
  return mutate(context, id, mediaExists);
}
