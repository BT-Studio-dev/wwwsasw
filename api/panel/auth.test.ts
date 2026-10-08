import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { panelApi } from "./routes";

function makeApp() {
  const app = new Hono();
  app.route("/api", panelApi);
  return app;
}

const jsonHeaders = {
  "Content-Type": "application/json",
  "x-btp-csrf": "1",
};

describe("panel auth & demo account flow", () => {
  it("exposes public settings with the demo admin/admin1234 account", async () => {
    const res = await makeApp().request("/api/public-settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demos).toEqual([
      { label: "Owner", username: "admin", password: "admin1234" },
    ]);
  });

  it("signs in with the seeded demo account (admin / admin1234)", async () => {
    const res = await makeApp().request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ identifier: "admin", password: "admin1234" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^ses_/);
    expect(body.panel.profile.username).toBe("admin");
    expect(body.panel.profile.role).toBe("owner");
  });

  it("registers a new user and supports forgot + reset password flow", async () => {
    const app = makeApp();
    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `demo_${suffix}`;
    const email = `${username}@example.com`;

    const regRes = await app.request("/api/auth/register", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ username, email, password: "password1234" }),
    });
    expect(regRes.status).toBe(200);
    const regBody = await regRes.json();
    expect(regBody.ok).toBe(true);
    expect(regBody.panel.profile.username).toBe(username);

    const forgotRes = await app.request("/api/auth/forgot", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ identifier: username }),
    });
    expect(forgotRes.status).toBe(200);
    const forgotBody = await forgotRes.json();
    expect(forgotBody.ok).toBe(true);
    expect(forgotBody.previewUrl).toMatch(/^\/reset\?token=rst_/);

    const token = String(forgotBody.previewUrl).split("token=")[1];
    const resetRes = await app.request("/api/auth/reset", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ token, password: "admin1234" }),
    });
    expect(resetRes.status).toBe(200);

    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ identifier: email, password: "admin1234" }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.ok).toBe(true);
  });
});
