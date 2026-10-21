import { Elysia } from "elysia";
import { agentKeysApp } from "./agentKeysApp.ts";
import { deviceLoginApp } from "./deviceLoginApp.ts";
import { downloadsApp } from "./downloadsApp.ts";
import { sourcesApp } from "./sourcesApp.ts";

/** Route groups with their own plugins: downloads, source plugins, agent keys and TV sign-in. */
export const adminApps = new Elysia({ name: "admin-apps" })
  .use(downloadsApp)
  .use(sourcesApp)
  .use(agentKeysApp)
  .use(deviceLoginApp);
