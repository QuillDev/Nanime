import { Elysia } from "elysia";
import { agentKeysApp } from "./agentKeysApp.ts";
import { downloadsApp } from "./downloadsApp.ts";
import { sourcesApp } from "./sourcesApp.ts";

/** Downloads, source plugins and agent keys: admin route groups with their own plugins. */
export const adminApps = new Elysia({ name: "admin-apps" })
  .use(downloadsApp)
  .use(sourcesApp)
  .use(agentKeysApp);
