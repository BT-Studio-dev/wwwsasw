import { describe, expect, it } from "vitest";
import {
  PterodactylApiError,
  PterodactylClient,
  pterodactylApiErrorResponse,
  pterodactylConfigStatus,
  validateAllocationInput,
} from "./client";

const env = {
  PTERODACTYL_URL: "https://panel.example.test",
  PTERODACTYL_APPLICATION_TOKEN: "server-side-test-token",
  PTERODACTYL_TIMEOUT_MS: "1000",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("Pterodactyl Application API client", () => {
  it("reports missing and malformed configuration without exposing credentials", () => {
    expect(pterodactylConfigStatus({}).message).toContain("PTERODACTYL_URL");
    const invalid = pterodactylConfigStatus({
      PTERODACTYL_URL: "https://admin:password@panel.example.test/?secret=value",
      PTERODACTYL_APPLICATION_TOKEN: "do-not-return-this-token",
    });
    expect(invalid.configured).toBe(false);
    expect(invalid.message).not.toContain("password");
    expect(invalid.message).not.toContain("do-not-return-this-token");
  });

  it("uses the Application API bearer token on the server and returns a safe server projection", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const client = new PterodactylClient({
      env,
      fetcher: async (input, init) => {
        calls.push({ url: new URL(String(input)), init });
        return json({ data: [{ attributes: {
          id: 17,
          name: "Survival",
          identifier: "ab12cd34",
          uuid: "uuid-1",
          status: null,
          suspended: false,
          node: 3,
          allocation: 41,
          nest: 1,
          egg: 5,
          limits: { memory: 2048, disk: 4096, cpu: 100, swap: 0 },
          application_token: "must-not-be-returned",
        } }], meta: { pagination: { current_page: 1, total_pages: 1 } } });
      },
    });

    const servers = await client.getServers();
    expect(calls[0].url.pathname).toBe("/api/application/servers");
    expect(calls[0].url.searchParams.get("per_page")).toBe("100");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer server-side-test-token");
    expect((calls[0].init?.headers as Record<string, string>).Accept).toContain("pterodactyl");
    expect(servers).toEqual([expect.objectContaining({ id: "17", name: "Survival", nodeId: "3", allocationId: "41", limits: { memory: 2048, disk: 4096, cpu: 100, swap: 0 } })]);
    expect(JSON.stringify(servers)).not.toContain("must-not-be-returned");
  });

  it("follows API pagination until all pages are read", async () => {
    const pages: number[] = [];
    const client = new PterodactylClient({
      env,
      fetcher: async (input) => {
        const url = new URL(String(input));
        const page = Number(url.searchParams.get("page"));
        pages.push(page);
        return json({
          data: [{ attributes: { id: page, name: `Server ${page}` } }],
          meta: { pagination: { current_page: page, total_pages: 2, count: 1 } },
        });
      },
    });
    const servers = await client.getServers();
    expect(pages).toEqual([1, 2]);
    expect(servers.map((server) => server.id)).toEqual(["1", "2"]);
  });

  it("loads node allocations and nests with their eggs from real endpoint shapes", async () => {
    const client = new PterodactylClient({
      env,
      fetcher: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/nodes")) return json({ data: [{ attributes: { id: 3, name: "Compute A", fqdn: "node.example.test", scheme: "https", memory: 8192, disk: 50000, daemon_listen: 8080, daemon_sftp: 2022, maintenance_mode: false } }], meta: { pagination: { total_pages: 1 } } });
        if (url.pathname.endsWith("/nodes/3/allocations")) return json({ data: [{ attributes: { id: 41, ip: "203.0.113.4", alias: null, port: 25565, assigned: false } }], meta: { pagination: { total_pages: 1 } } });
        if (url.pathname.endsWith("/nests")) return json({ data: [{ attributes: { id: 1, name: "Minecraft", description: "Game servers", script: "must-not-leak" } }], meta: { pagination: { total_pages: 1 } } });
        if (url.pathname.endsWith("/nests/1/eggs")) return json({ data: [{ attributes: { id: 5, uuid: "egg-uuid", name: "Paper", author: "Pterodactyl", docker_image: "ghcr.io/example/image", install_script: "must-not-leak" } }] });
        throw new Error(`Unexpected request ${url}`);
      },
    });

    const [nodes, nests] = await Promise.all([client.getNodes(), client.getNests()]);
    expect(nodes[0]).toMatchObject({ id: "3", maintenanceMode: false, allocations: [{ id: "41", port: 25565, assigned: false }] });
    expect(nests[0].eggs[0]).toMatchObject({ id: "5", name: "Paper", dockerImage: "ghcr.io/example/image" });
    expect(JSON.stringify({ nodes, nests })).not.toContain("must-not-leak");
  });

  it("posts valid allocation inputs and calls the documented suspend endpoint", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const client = new PterodactylClient({
      env,
      fetcher: async (input, init) => {
        requests.push({ url: new URL(String(input)), init });
        return new Response(null, { status: 204 });
      },
    });
    const allocation = validateAllocationInput({ ip: "203.0.113.4", alias: "game", ports: ["25565", "25570-25575"] });
    await client.createAllocations("3", allocation);
    await client.setServerSuspended("17", true);
    await client.setServerSuspended("17", false);

    expect(requests[0].url.pathname).toBe("/api/application/nodes/3/allocations");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ ip: "203.0.113.4", alias: "game", ports: ["25565", "25570-25575"] });
    expect(requests[1].url.pathname).toBe("/api/application/servers/17/suspend");
    expect(requests[2].url.pathname).toBe("/api/application/servers/17/unsuspend");
  });

  it("rejects malformed allocation ranges before making a request", () => {
    expect(() => validateAllocationInput({ ip: "node", ports: ["0"] })).toThrow("between 1 and 65535");
    expect(() => validateAllocationInput({ ip: "node", ports: ["25580-25570"] })).toThrow("ascending order");
    expect(() => validateAllocationInput({ ip: "node", ports: ["bad"] })).toThrow("port ranges");
  });

  it("maps upstream authorization errors to a safe gateway response", async () => {
    const client = new PterodactylClient({ env, fetcher: async () => json({ errors: [{ detail: "Unauthorized" }] }, 401) });
    await expect(client.getServers()).rejects.toMatchObject({ kind: "upstream", upstreamStatus: 401 });
    expect(pterodactylApiErrorResponse(new PterodactylApiError("timeout", "timeout"))).toEqual({ status: 504, message: "timeout" });
  });

  it("aborts a hung API request at the configured timeout", async () => {
    const client = new PterodactylClient({
      env,
      fetcher: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    await expect(client.getServers()).rejects.toMatchObject({ kind: "timeout" });
  });
});
