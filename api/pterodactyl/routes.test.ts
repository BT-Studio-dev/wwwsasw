import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { users } from "@db/schema";
import { pterodactylApi } from "./routes";

type PanelUser = typeof users.$inferSelect;

function makeApp(role: "owner" | "admin" | "member") {
  const app = new Hono<{ Variables: { user: PanelUser } }>();
  app.use("*", async (c, next) => {
    c.set("user", { role } as PanelUser);
    await next();
  });
  app.route("/api/pterodactyl", pterodactylApi);
  return app;
}

afterEach(() => vi.unstubAllEnvs());

describe("Pterodactyl panel routes", () => {
  it("blocks non-admin users before exposing integration status", async () => {
    const response = await makeApp("member").request("/api/pterodactyl/status");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Administrator access required." });
  });

  it("returns only the public panel URL, never the configured application token", async () => {
    vi.stubEnv("PTERODACTYL_URL", "https://panel.example.test/prefix");
    vi.stubEnv("PTERODACTYL_APPLICATION_TOKEN", "server-only-secret-value");
    const response = await makeApp("owner").request("/api/pterodactyl/status");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ configured: true, panelUrl: "https://panel.example.test/prefix" });
    expect(JSON.stringify(body)).not.toContain("server-only-secret-value");
  });

  it("validates node ids before proxying allocation writes", async () => {
    const response = await makeApp("admin").request("/api/pterodactyl/nodes/not-a-number/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip: "203.0.113.4", ports: ["25565"] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Pterodactyl node id." });
  });
});
