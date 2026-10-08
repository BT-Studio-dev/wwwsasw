import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import type { users } from "@db/schema";
import { isAdminRole } from "@contracts/panel/types";
import {
  PterodactylApiError,
  PterodactylClient,
  pterodactylApiErrorResponse,
  pterodactylConfigStatus,
  validateAllocationInput,
  isSafePterodactylId,
} from "./client";

type PanelUser = typeof users.$inferSelect;

export const pterodactylApi = new Hono<{ Bindings: HttpBindings; Variables: { user: PanelUser } }>();

pterodactylApi.use("*", async (c, next) => {
  if (!isAdminRole(c.get("user").role)) return c.json({ error: "Administrator access required." }, 403);
  return next();
});

pterodactylApi.onError((error, c) => {
  const result = pterodactylApiErrorResponse(error);
  if (!(error instanceof PterodactylApiError)) console.error("[bt-panel] pterodactyl integration error", error);
  return c.json({ error: result.message }, result.status);
});

pterodactylApi.get("/status", (c) => c.json(pterodactylConfigStatus()));

pterodactylApi.get("/servers", async (c) => {
  const servers = await new PterodactylClient({}).getServers();
  return c.json({ servers });
});

pterodactylApi.get("/nodes", async (c) => {
  const nodes = await new PterodactylClient({}).getNodes();
  return c.json({ nodes });
});

pterodactylApi.get("/nests", async (c) => {
  const nests = await new PterodactylClient({}).getNests();
  return c.json({ nests });
});

pterodactylApi.post("/nodes/:nodeId/allocations", async (c) => {
  const nodeId = c.req.param("nodeId");
  if (!isSafePterodactylId(nodeId)) return c.json({ error: "Invalid Pterodactyl node id." }, 400);
  let input;
  try {
    input = validateAllocationInput(await c.req.json());
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid allocation request." }, 400);
  }
  await new PterodactylClient({}).createAllocations(nodeId, input);
  return c.json({ ok: true });
});

pterodactylApi.post("/servers/:serverId/suspend", async (c) => {
  const serverId = c.req.param("serverId");
  if (!isSafePterodactylId(serverId)) return c.json({ error: "Invalid Pterodactyl server id." }, 400);
  await new PterodactylClient({}).setServerSuspended(serverId, true);
  return c.json({ ok: true });
});

pterodactylApi.post("/servers/:serverId/unsuspend", async (c) => {
  const serverId = c.req.param("serverId");
  if (!isSafePterodactylId(serverId)) return c.json({ error: "Invalid Pterodactyl server id." }, 400);
  await new PterodactylClient({}).setServerSuspended(serverId, false);
  return c.json({ ok: true });
});
