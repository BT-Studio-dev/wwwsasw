import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  Cable,
  CheckCircle2,
  CircleAlert,
  Network,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import type {
  AllocationCreateInput,
  PterodactylAllocation,
  PterodactylEgg,
  PterodactylNest,
  PterodactylNode,
  PterodactylServer,
  PterodactylStatus,
} from "@contracts/pterodactyl";
import { api, cn, formatMb } from "@/lib/utils";
import { Spinner } from "../ui";

type Tab = "servers" | "nodes" | "eggs";
type AllocationForm = { ip: string; alias: string; ports: string };
const EMPTY_FORM: AllocationForm = { ip: "", alias: "", ports: "" };

export function PterodactylView() {
  const [status, setStatus] = useState<PterodactylStatus | null>(null);
  const [servers, setServers] = useState<PterodactylServer[]>([]);
  const [nodes, setNodes] = useState<PterodactylNode[]>([]);
  const [nests, setNests] = useState<PterodactylNest[]>([]);
  const [tab, setTab] = useState<Tab>("servers");
  const [loading, setLoading] = useState(true);
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, AllocationForm>>({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const connection = await api<PterodactylStatus>("/api/pterodactyl/status");
      setStatus(connection);
      if (!connection.configured) {
        setServers([]);
        setNodes([]);
        setNests([]);
        return;
      }
      const [serverResult, nodeResult, nestResult] = await Promise.all([
        api<{ servers: PterodactylServer[] }>("/api/pterodactyl/servers"),
        api<{ nodes: PterodactylNode[] }>("/api/pterodactyl/nodes"),
        api<{ nests: PterodactylNest[] }>("/api/pterodactyl/nests"),
      ]);
      setServers(serverResult.servers);
      setNodes(nodeResult.nodes);
      setNests(nestResult.nests);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Pterodactyl resources.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const allocationsById = useMemo(() => {
    const map = new Map<string, { node: PterodactylNode; allocation: PterodactylAllocation }>();
    for (const node of nodes) for (const allocation of node.allocations) map.set(allocation.id, { node, allocation });
    return map;
  }, [nodes]);
  const allEggs = useMemo(() => nests.flatMap((nest) => nest.eggs), [nests]);

  async function setSuspended(server: PterodactylServer) {
    const verb = server.suspended ? "unsuspend" : "suspend";
    const prompt = server.suspended
      ? `Unsuspend “${server.name}” in Pterodactyl?`
      : `Suspend “${server.name}” in Pterodactyl? Its owner will lose access until it is unsuspended.`;
    if (!window.confirm(prompt)) return;
    setBusyServer(server.id);
    try {
      await api(`/api/pterodactyl/servers/${server.id}/${verb}`, { method: "POST", body: {} });
      toast.success(server.suspended ? "Server unsuspended." : "Server suspended.");
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Server action failed.");
    } finally {
      setBusyServer(null);
    }
  }

  async function addAllocations(node: PterodactylNode) {
    const form = forms[node.id] ?? EMPTY_FORM;
    const ports = form.ports.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
    if (!form.ip.trim() || ports.length === 0) {
      toast.error("Enter an allocation IP or host and at least one port.");
      return;
    }
    const input: AllocationCreateInput = { ip: form.ip.trim(), alias: form.alias.trim() || undefined, ports };
    setBusyNode(node.id);
    try {
      await api(`/api/pterodactyl/nodes/${node.id}/allocations`, { method: "POST", body: input });
      toast.success("Allocation request accepted by Pterodactyl.");
      setForms((current) => ({ ...current, [node.id]: EMPTY_FORM }));
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add allocations.");
    } finally {
      setBusyNode(null);
    }
  }

  return (
    <div className="view-enter space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[22px] font-extrabold tracking-tight">
            <Cable className="size-5 text-accent" /> Pterodactyl Integration
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] font-semibold text-steel">
            Live Application API resources for servers, Wings nodes, nests, eggs, and network allocations.
          </p>
        </div>
        <button type="button" className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-[12px] font-bold" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="size-3.5" />} Refresh data
        </button>
      </div>

      <section className="glass flex flex-wrap items-center gap-3 px-4 py-3">
        {status?.configured ? <CheckCircle2 className="size-4 shrink-0 text-emerald-400" /> : <CircleAlert className="size-4 shrink-0 text-amber-400" />}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-extrabold">{status?.configured ? "Pterodactyl credentials configured" : "Pterodactyl is not configured"}</div>
          <div className="mt-0.5 break-all text-[11px] font-medium text-steel">
            {status?.configured ? status.panelUrl : status?.message ?? "Checking server-side configuration…"}
          </div>
        </div>
        {status?.configured ? <span className="rounded-full border border-line px-2 py-1 text-[10px] font-extrabold text-steel">Application API</span> : null}
      </section>

      {!status?.configured && !loading ? (
        <section className="glass flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="text-[12px] leading-5 text-steel">{status?.message ?? "Configure the Pterodactyl server environment variables and restart BT Panel."} See README for setup and required API permissions.</div>
        </section>
      ) : null}

      {status?.configured ? (
        <>
          <div className="flex flex-wrap gap-2">
            <TabButton selected={tab === "servers"} onClick={() => setTab("servers")} icon={<Server className="size-3.5" />} label={`Servers (${servers.length})`} />
            <TabButton selected={tab === "nodes"} onClick={() => setTab("nodes")} icon={<Network className="size-3.5" />} label={`Wings nodes (${nodes.length})`} />
            <TabButton selected={tab === "eggs"} onClick={() => setTab("eggs")} icon={<Boxes className="size-3.5" />} label={`Nests & eggs (${allEggs.length})`} />
          </div>

          {loading ? <div className="glass flex items-center gap-2 p-5 text-[12px] font-bold text-steel"><Spinner /> Loading live Pterodactyl data…</div> : null}
          {!loading && tab === "servers" ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {servers.map((server) => {
                const primary = allocationsById.get(server.allocationId);
                const node = nodeById.get(server.nodeId);
                const lifecycle = server.suspended ? "Suspended" : server.status ?? "Ready";
                return (
                  <article key={server.id} className="glass p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-extrabold">{server.name}</div>
                        <div className="mt-1 font-mono text-[10px] text-steel">{server.identifier || server.uuid}</div>
                      </div>
                      <span className={cn("rounded-full border px-2 py-1 text-[10px] font-extrabold", server.suspended ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-line text-steel")}>
                        {lifecycle}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <DataField label="Node" value={node?.name ?? (server.nodeId ? `Node ${server.nodeId}` : "Not assigned")} />
                      <DataField label="Primary allocation" value={primary ? `${primary.allocation.alias || primary.allocation.ip}:${primary.allocation.port}` : (server.allocationId ? `Allocation ${server.allocationId}` : "Not assigned")} />
                      <DataField label="Memory" value={server.limits.memory ? formatMb(server.limits.memory) : "Unlimited / not set"} />
                      <DataField label="Disk" value={server.limits.disk ? formatMb(server.limits.disk) : "Unlimited / not set"} />
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button type="button" onClick={() => void setSuspended(server)} disabled={busyServer === server.id} className="btn-ghost inline-flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-bold">
                        {busyServer === server.id ? <Spinner /> : server.suspended ? <ShieldCheck className="size-3.5" /> : <ShieldOff className="size-3.5" />}
                        {server.suspended ? "Unsuspend" : "Suspend"}
                      </button>
                    </div>
                  </article>
                );
              })}
              {!servers.length ? <Empty title="No Pterodactyl servers found" detail="The configured Application API key may not have server-read permission, or the panel has no servers." /> : null}
            </div>
          ) : null}

          {!loading && tab === "nodes" ? (
            <div className="grid gap-3">
              {nodes.map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  busy={busyNode === node.id}
                  form={forms[node.id] ?? EMPTY_FORM}
                  onFormChange={(patch) => setForms((current) => ({ ...current, [node.id]: { ...(current[node.id] ?? EMPTY_FORM), ...patch } }))}
                  onCreate={() => void addAllocations(node)}
                />
              ))}
              {!nodes.length ? <Empty title="No nodes found" detail="Nodes are read from the Pterodactyl Application API. Check that the token has node-read permission." /> : null}
            </div>
          ) : null}

          {!loading && tab === "eggs" ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {nests.map((nest) => <NestCard key={nest.id} nest={nest} />)}
              {!nests.length ? <Empty title="No nests found" detail="Nests and their eggs are read from Pterodactyl. Check the API token permissions." /> : null}
            </div>
          ) : null}
        </>
      ) : null}

      <section className="glass flex gap-3 p-4 text-[11px] leading-5 text-steel">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <p>
          Wings is represented here through its Pterodactyl node records and maintenance state. The Application API does not expose a live Wings heartbeat or runtime console/power controls; those require a separate authenticated client/Wings integration. No daemon credentials are requested or sent to the browser.
        </p>
      </section>
    </div>
  );
}

function TabButton({ selected, onClick, icon, label }: { selected: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[11px] font-extrabold transition-colors", selected ? "border-accent/40 bg-accent/15 text-ice" : "border-line bg-fill text-steel hover:text-ice")}>
      {icon}{label}
    </button>
  );
}

function NodeCard({
  node,
  busy,
  form,
  onFormChange,
  onCreate,
}: {
  node: PterodactylNode;
  busy: boolean;
  form: AllocationForm;
  onFormChange: (patch: Partial<AllocationForm>) => void;
  onCreate: () => void;
}) {
  const allocated = node.allocations.filter((item) => item.assigned).length;
  return (
    <article className="glass p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[14px] font-extrabold"><Network className="size-4 text-accent" />{node.name}</div>
          <div className="mt-1 break-all font-mono text-[10px] text-steel">{node.scheme}://{node.fqdn}:{node.daemonListen}</div>
        </div>
        <span className={cn("rounded-full border px-2 py-1 text-[10px] font-extrabold", node.maintenanceMode ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300")}>
          {node.maintenanceMode ? "Maintenance mode" : "Maintenance off"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DataField label="Memory capacity" value={node.memory ? formatMb(node.memory) : "Not reported"} />
        <DataField label="Disk capacity" value={node.disk ? formatMb(node.disk) : "Not reported"} />
        <DataField label="Allocations" value={String(node.allocations.length)} />
        <DataField label="Assigned" value={`${allocated} / ${node.allocations.length}`} />
      </div>
      {node.allocations.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {node.allocations.slice(0, 80).map((allocation) => (
            <span key={allocation.id} title={allocation.notes ?? undefined} className={cn("rounded-md border px-2 py-1 font-mono text-[10px]", allocation.assigned ? "border-line bg-fill text-steel" : "border-emerald-500/25 bg-emerald-500/5 text-emerald-300")}>
              {allocation.alias || allocation.ip}:{allocation.port}{allocation.assigned ? " · used" : " · free"}
            </span>
          ))}
          {node.allocations.length > 80 ? <span className="px-2 py-1 text-[10px] text-steel">+{node.allocations.length - 80} more</span> : null}
        </div>
      ) : null}
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold"><Plus className="size-3.5 text-accent" /> Add network allocation</div>
        <div className="grid gap-2 sm:grid-cols-[1.1fr_1fr_1.3fr_auto]">
          <input className="panel-input h-9 text-[11px]" aria-label="Allocation IP" placeholder="Allocation IP" value={form.ip} onChange={(event) => onFormChange({ ip: event.target.value })} />
          <input className="panel-input h-9 text-[11px]" aria-label="IP alias (optional)" placeholder="Alias (optional)" value={form.alias} onChange={(event) => onFormChange({ alias: event.target.value })} />
          <input className="panel-input h-9 text-[11px]" aria-label="Port list or ranges" placeholder="25565, 25570-25575" value={form.ports} onChange={(event) => onFormChange({ ports: event.target.value })} />
          <button type="button" className="btn-accent inline-flex h-9 items-center justify-center gap-2 px-3 text-[11px] font-extrabold" disabled={busy} onClick={onCreate}>
            {busy ? <Spinner /> : <Plus className="size-3.5" />} Add ports
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-steel">Creates the allocation(s) on this Pterodactyl node. The server validates port ranges and conflicts.</p>
      </div>
    </article>
  );
}

function NestCard({ nest }: { nest: PterodactylNest }) {
  return (
    <article className="glass p-4">
      <div className="flex items-center gap-2 text-[14px] font-extrabold"><Boxes className="size-4 text-accent" />{nest.name}</div>
      <p className="mt-1 text-[11px] text-steel">{nest.description || `${nest.eggs.length} egg${nest.eggs.length === 1 ? "" : "s"}`}</p>
      <div className="mt-3 grid gap-2">
        {nest.eggs.map((egg) => <EggRow key={egg.id} egg={egg} />)}
        {!nest.eggs.length ? <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-steel">No eggs in this nest.</p> : null}
      </div>
    </article>
  );
}

function EggRow({ egg }: { egg: PterodactylEgg }) {
  return (
    <div className="rounded-[10px] border border-line bg-fill px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div className="text-[12px] font-bold">{egg.name}<span className="ml-2 font-mono text-[10px] font-medium text-steel">#{egg.id}</span></div>
        {egg.author ? <span className="text-[10px] text-steel">{egg.author}</span> : null}
      </div>
      {egg.description ? <p className="mt-1 text-[10px] leading-4 text-steel">{egg.description}</p> : null}
      {egg.dockerImage ? <div className="mt-1 truncate font-mono text-[10px] text-faint">{egg.dockerImage}</div> : null}
    </div>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-[9px] border border-line bg-fill px-2.5 py-2">
    <div className="text-[9px] font-extrabold tracking-[0.08em] text-faint uppercase">{label}</div>
    <div className="mt-0.5 truncate text-[11px] font-bold text-ice" title={value}>{value}</div>
  </div>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="glass flex min-h-28 flex-col items-center justify-center gap-1 px-4 py-6 text-center">
    <Server className="size-4 text-steel" />
    <div className="text-[12px] font-extrabold">{title}</div>
    <p className="max-w-xl text-[11px] text-steel">{detail}</p>
  </div>;
}

