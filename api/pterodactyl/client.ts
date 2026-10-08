import type {
  AllocationCreateInput,
  PterodactylAllocation,
  PterodactylEgg,
  PterodactylNest,
  PterodactylNode,
  PterodactylServer,
} from "@contracts/pterodactyl";

const API_PREFIX = "/api/application";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 12_000;

type Environment = Record<string, string | undefined>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type Resource = { id?: string | number; attributes?: JsonRecord };

type PterodactylConfig = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
};

type ConfigRead = { config: PterodactylConfig | null; issue: string | null };

export class PterodactylApiError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "invalid_config" | "timeout" | "network" | "upstream" | "invalid_response",
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "PterodactylApiError";
  }
}

function parseBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new PterodactylApiError("PTERODACTYL_URL must be an absolute HTTP(S) URL.", "invalid_config");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PterodactylApiError("PTERODACTYL_URL must use HTTP or HTTPS.", "invalid_config");
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PterodactylApiError("PTERODACTYL_URL cannot contain credentials, a query, or a fragment.", "invalid_config");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function readConfig(env: Environment): ConfigRead {
  const url = env.PTERODACTYL_URL?.trim() ?? "";
  const token = env.PTERODACTYL_APPLICATION_TOKEN?.trim() ?? "";
  if (!url || !token) {
    const missing = [!url && "PTERODACTYL_URL", !token && "PTERODACTYL_APPLICATION_TOKEN"].filter(Boolean).join(" and ");
    return { config: null, issue: `Set ${missing} on the BT Panel server to enable this integration.` };
  }
  if (token.length > 512 || /[\r\n]/.test(token)) {
    return { config: null, issue: "PTERODACTYL_APPLICATION_TOKEN has an invalid format." };
  }
  try {
    const timeout = Number(env.PTERODACTYL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeout) ? Math.max(1_000, Math.min(timeout, 60_000)) : DEFAULT_TIMEOUT_MS;
    return { config: { baseUrl: parseBaseUrl(url), token, timeoutMs }, issue: null };
  } catch (error) {
    return {
      config: null,
      issue: error instanceof PterodactylApiError ? error.message : "Pterodactyl configuration is invalid.",
    };
  }
}

export function pterodactylConfigStatus(env: Environment = process.env) {
  const result = readConfig(env);
  return {
    configured: result.config !== null,
    panelUrl: result.config ? result.config.baseUrl : null,
    message: result.config ? "Connected configuration found. Live data is checked when you refresh resources." : result.issue!,
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function resourceAttributes(value: unknown): JsonRecord {
  const resource = asRecord(value);
  return { ...asRecord(resource.attributes), id: resource.id ?? asRecord(resource.attributes).id };
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function assertResourceArray(data: unknown, context: string): Resource[] {
  if (!Array.isArray(data)) throw new PterodactylApiError(`Pterodactyl returned an invalid ${context} list.`, "invalid_response");
  return data.map((item) => asRecord(item) as Resource);
}

export class PterodactylClient {
  private readonly config: PterodactylConfig;
  private readonly fetcher: Fetcher;

  constructor(options: { env?: Environment; fetcher?: Fetcher }) {
    const result = readConfig(options.env ?? process.env);
    if (!result.config) {
      throw new PterodactylApiError(result.issue ?? "Pterodactyl is not configured.", "not_configured");
    }
    this.config = result.config;
    this.fetcher = options.fetcher ?? fetch;
  }

  private endpoint(path: string): URL {
    const relative = `${API_PREFIX}/${path.replace(/^\/+/, "")}`;
    return new URL(`${this.config.baseUrl}${relative}`);
  }

  private async request<T = unknown>(path: string, init: { method?: string; body?: unknown; query?: URLSearchParams } = {}): Promise<T> {
    const url = this.endpoint(path);
    init.query?.forEach((value, key) => url.searchParams.set(key, value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const headers: Record<string, string> = {
      Accept: "application/vnd.pterodactyl.v1+json",
      Authorization: `Bearer ${this.config.token}`,
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    try {
      const response = await this.fetcher(url, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      if (response.status === 204) return undefined as T;
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const root = asRecord(payload);
        const firstError = Array.isArray(root.errors) ? asRecord(root.errors[0]) : {};
        const detail = asString(firstError.detail) || asString(root.message);
        const safeDetail = detail && detail.length < 280 ? ` ${detail}` : "";
        throw new PterodactylApiError(
          `Pterodactyl returned HTTP ${response.status}.${safeDetail}`,
          "upstream",
          response.status,
        );
      }
      if (payload === null || typeof payload !== "object") {
        throw new PterodactylApiError("Pterodactyl returned an invalid API response.", "invalid_response");
      }
      return payload as T;
    } catch (error) {
      if (error instanceof PterodactylApiError) throw error;
      if (controller.signal.aborted) {
        throw new PterodactylApiError("The Pterodactyl request timed out. Check the panel URL and network connection.", "timeout");
      }
      throw new PterodactylApiError("Could not reach the Pterodactyl panel. Check the server URL and network connection.", "network");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listAll(path: string): Promise<Resource[]> {
    const resources: Resource[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) });
      const result = asRecord(await this.request(`${path}?${query.toString()}`));
      const batch = assertResourceArray(result.data, path);
      resources.push(...batch);
      const pagination = asRecord(asRecord(result.meta).pagination);
      const totalPages = asNumber(pagination.total_pages);
      const count = asNumber(pagination.count);
      if (totalPages > 0 ? page >= totalPages : batch.length < PAGE_SIZE || count === 0) return resources;
    }
    throw new PterodactylApiError(`Pterodactyl returned more than ${MAX_PAGES * PAGE_SIZE} records for ${path}.`, "invalid_response");
  }

  async getServers(): Promise<PterodactylServer[]> {
    return (await this.listAll("servers")).map((item) => {
      const attrs = resourceAttributes(item);
      const limits = asRecord(attrs.limits);
      return {
        id: asString(attrs.id),
        name: asString(attrs.name, "Unnamed server"),
        identifier: asString(attrs.identifier),
        uuid: asString(attrs.uuid),
        status: optionalString(attrs.status),
        suspended: asBoolean(attrs.suspended),
        nodeId: asString(attrs.node),
        allocationId: asString(attrs.allocation),
        nestId: asString(attrs.nest),
        eggId: asString(attrs.egg),
        limits: {
          memory: asNumber(limits.memory),
          disk: asNumber(limits.disk),
          cpu: asNumber(limits.cpu),
          swap: asNumber(limits.swap),
        },
        createdAt: optionalString(attrs.created_at),
      };
    });
  }

  async getNodes(): Promise<PterodactylNode[]> {
    const nodes = await this.listAll("nodes");
    return this.mapConcurrent(nodes, 5, async (item) => {
      const attrs = resourceAttributes(item);
      const id = asString(attrs.id);
      const allocations = await this.listAll(`nodes/${encodeURIComponent(id)}/allocations`);
      return {
        id,
        uuid: asString(attrs.uuid),
        name: asString(attrs.name, `Node ${id}`),
        description: asString(attrs.description),
        fqdn: asString(attrs.fqdn),
        scheme: asString(attrs.scheme, "https"),
        maintenanceMode: asBoolean(attrs.maintenance_mode),
        memory: asNumber(attrs.memory),
        disk: asNumber(attrs.disk),
        daemonListen: asNumber(attrs.daemon_listen),
        daemonSftp: asNumber(attrs.daemon_sftp),
        allocations: allocations.map((allocation) => {
          const row = resourceAttributes(allocation);
          return {
            id: asString(row.id),
            ip: asString(row.ip),
            alias: optionalString(row.alias),
            port: asNumber(row.port),
            notes: optionalString(row.notes),
            assigned: asBoolean(row.assigned),
          } satisfies PterodactylAllocation;
        }),
      };
    });
  }

  async getNests(): Promise<PterodactylNest[]> {
    const nests = await this.listAll("nests");
    return this.mapConcurrent(nests, 5, async (item) => {
      const attrs = resourceAttributes(item);
      const id = asString(attrs.id);
      const response = asRecord(await this.request(`nests/${encodeURIComponent(id)}/eggs`));
      const eggs = assertResourceArray(response.data, `eggs for nest ${id}`);
      return {
        id,
        name: asString(attrs.name, `Nest ${id}`),
        description: asString(attrs.description),
        eggs: eggs.map((egg) => {
          const row = resourceAttributes(egg);
          return {
            id: asString(row.id),
            uuid: asString(row.uuid),
            name: asString(row.name, `Egg ${asString(row.id)}`),
            author: asString(row.author),
            description: asString(row.description),
            dockerImage: asString(row.docker_image),
          } satisfies PterodactylEgg;
        }),
      };
    });
  }

  async createAllocations(nodeId: string, input: AllocationCreateInput): Promise<void> {
    await this.request(`nodes/${encodeURIComponent(nodeId)}/allocations`, {
      method: "POST",
      body: { ip: input.ip, ports: input.ports, ...(input.alias ? { alias: input.alias } : {}) },
    });
  }

  async setServerSuspended(serverId: string, suspended: boolean): Promise<void> {
    await this.request(`servers/${encodeURIComponent(serverId)}/${suspended ? "suspend" : "unsuspend"}`, {
      method: "POST",
      body: {},
    });
  }

  private async mapConcurrent<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
    const output = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        output[index] = await map(items[index]);
      }
    });
    await Promise.all(workers);
    return output;
  }
}

export function pterodactylApiErrorResponse(error: unknown): { status: 502 | 503 | 504; message: string } {
  if (!(error instanceof PterodactylApiError)) {
    return { status: 502, message: "The Pterodactyl integration failed unexpectedly." };
  }
  if (error.kind === "not_configured" || error.kind === "invalid_config") return { status: 503, message: error.message };
  if (error.kind === "timeout") return { status: 504, message: error.message };
  return { status: 502, message: error.message };
}

export function pterodactylStatusMessage(error: unknown): string {
  return error instanceof PterodactylApiError ? error.message : "Pterodactyl configuration is invalid.";
}

export function inspectPterodactylEnv(env: Environment = process.env) {
  return pterodactylConfigStatus(env);
}

export function isSafePterodactylId(value: string): boolean {
  return /^\d{1,12}$/.test(value);
}

export function validateAllocationInput(value: unknown): AllocationCreateInput {
  const body = asRecord(value);
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  const alias = typeof body.alias === "string" ? body.alias.trim() : "";
  const ports = Array.isArray(body.ports) ? body.ports : [];
  if (!ip || ip.length > 191) throw new Error("Enter an IP address or allocation host name (up to 191 characters).");
  if (alias.length > 191) throw new Error("The allocation alias must be 191 characters or fewer.");
  if (ports.length < 1 || ports.length > 100 || ports.some((port) => typeof port !== "string" || !/^\d{1,5}(?:-\d{1,5})?$/.test(port))) {
    throw new Error("Enter between 1 and 100 ports or port ranges, such as 25565 or 25570-25575.");
  }
  for (const entry of ports as string[]) {
    const [from, to = from] = entry.split("-").map(Number);
    if (from < 1 || to > 65535 || from > to) throw new Error("Ports must be between 1 and 65535, with ranges in ascending order.");
  }
  return { ip, ...(alias ? { alias } : {}), ports: ports as string[] };
}
