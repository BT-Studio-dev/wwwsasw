import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  nodes,
  panelSettings,
  serverBackups,
  serverEvents,
  servers,
  sessions,
  users,
} from "@db/schema";
import {
  DEFAULT_SETTINGS,
  isAdminRole,
  type NodeDto,
  type PanelProfile,
  type PanelSettings,
  type ServerDto,
  type ServerEventDto,
} from "@contracts/panel/types";
import { getTemplate } from "@contracts/panel/catalog";
import { parseLanguage } from "@contracts/panel/i18n";
import { clamp, toHexColor } from "@contracts/utils";
import { newId, seededNumber } from "./util";

export const SETTINGS_ID = 1;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const START_MS = 8_000;
const STOP_MS = 5_000;
const BACKUP_MS = 20_000;

type UserRow = typeof users.$inferSelect;
type ServerRow = typeof servers.$inferSelect;
type SettingsRow = typeof panelSettings.$inferSelect;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ── Settings ────────────────────────────────────────────────────────────────

export function rowToSettings(row: SettingsRow): PanelSettings {
  return {
    mode: row.themeMode === "light" ? "light" : "dark",
    wallpaperUrl: row.wallpaperUrl,
    bgBlur: row.bgBlur,
    bgOpacity: row.bgOpacity,
    wallpaperFit: row.wallpaperFit === "contain" || row.wallpaperFit === "tile" || row.wallpaperFit === "stretch" ? row.wallpaperFit : "cover",
    wallpaperZoom: row.wallpaperZoom,
    accentColor: row.accentColor,
    glassTint: row.glassTint,
    navText: row.navText,
    navTextActive: row.navTextActive,
    glassBlur: row.glassBlur,
    glassSaturate: row.glassSaturate,
    borderRadius: row.borderRadius,
    glassOpacity: row.glassOpacity,
    showTeam: row.showTeam,
    panelName: row.panelName,
    panelSubtitle: row.panelSubtitle,
    faviconTitle: row.faviconTitle,
    panelLogo: row.panelLogo,
    faviconLogo: row.faviconLogo,
    welcomeTitle: row.welcomeTitle,
    welcomeMessage: row.welcomeMessage,
    showAdminStats: row.showAdminStats,
    showVersion: row.showVersion,
    showRole: row.showRole,
    showHeaderUser: row.showHeaderUser,
    allowRegistration: row.allowRegistration,
    passwordResetEnabled: row.passwordResetEnabled,
    defaultLanguage: parseLanguage(row.defaultLanguage),
    requireTwoFactor: row.requireTwoFactor,
    maintenanceMode: row.maintenanceMode,
    maintenanceMessage: row.maintenanceMessage,
    maxServersPerUser: row.maxServersPerUser,
    defaultTemplate: row.defaultTemplate,
    backupRetention: row.backupRetention,
    debugLogging: row.debugLogging,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser,
    smtpPassConfigured: row.smtpPass !== "",
    smtpPass: "",
    smtpFrom: row.smtpFrom,
    googleOauthEnabled: row.googleOauthEnabled,
    googleClientId: row.googleClientId,
    googleClientSecretConfigured: row.googleClientSecret !== "",
    googleClientSecret: "",
    googleAllowedEmail: row.googleAllowedEmail,
  };
}

/** Reads the single settings row, creating it with defaults on first boot. */
export async function getSettingsRow(): Promise<SettingsRow> {
  const db = getDb();
  const rows = await db.select().from(panelSettings).where(eq(panelSettings.id, SETTINGS_ID)).limit(1);
  if (rows[0]) return rows[0];
  await db
    .insert(panelSettings)
    .values({ id: SETTINGS_ID, panelLogo: "", faviconLogo: "" })
    .catch(() => {});
  const created = await db.select().from(panelSettings).where(eq(panelSettings.id, SETTINGS_ID)).limit(1);
  return created[0] ?? ({ ...DEFAULTS_ROW } as SettingsRow);
}

const DEFAULTS_ROW = {
  id: SETTINGS_ID,
  themeMode: "dark",
  wallpaperUrl: "shader:waves",
  bgBlur: 0,
  bgOpacity: 100,
  wallpaperFit: "cover",
  wallpaperZoom: 100,
  accentColor: "#3b82f6",
  glassTint: "#0c1424",
  navText: "#9da3b4",
  navTextActive: "#e7e9f0",
  glassBlur: 20,
  glassSaturate: 160,
  borderRadius: 16,
  glassOpacity: 62,
  showTeam: true,
  panelName: "BT Panel",
  panelSubtitle: "Command center",
  faviconTitle: "BT Panel",
  panelLogo: "",
  faviconLogo: "",
  welcomeTitle: "Welcome",
  welcomeMessage: "Manage your panel from one place.",
  showAdminStats: true,
  showVersion: true,
  showRole: true,
  showHeaderUser: true,
  allowRegistration: true,
  tutorialsEnabled: true,
  passwordResetEnabled: true,
  defaultLanguage: "en",
  requireTwoFactor: false,
  maintenanceMode: false,
  maintenanceMessage: "",
  maxServersPerUser: 10,
  defaultTemplate: "minecraft",
  backupRetention: 5,
  debugLogging: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "BT Panel <no-reply@btpanel.local>",
  googleOauthEnabled: false,
  googleClientId: "",
  googleClientSecret: "",
  googleAllowedEmail: "",
  updatedAt: new Date(),
};

export async function getSettings(): Promise<PanelSettings> {
  return rowToSettings(await getSettingsRow());
}

const HEX_KEYS = ["accentColor", "glassTint", "navText", "navTextActive"] as const;
const INT_KEYS: Record<string, [number, number]> = {
  bgBlur: [0, 100],
  bgOpacity: [0, 100],
  wallpaperZoom: [100, 300],
  glassBlur: [0, 60],
  glassSaturate: [0, 300],
  borderRadius: [0, 32],
  glassOpacity: [0, 100],
  maxServersPerUser: [0, 1000],
  backupRetention: [0, 50],
  smtpPort: [1, 65535],
};
const BOOL_KEYS = [
  "showTeam",
  "showAdminStats",
  "showVersion",
  "showRole",
  "showHeaderUser",
  "allowRegistration",
  "passwordResetEnabled",
  "requireTwoFactor",
  "maintenanceMode",
  "debugLogging",
  "smtpSecure",
  "googleOauthEnabled",
] as const;
const STRING_KEYS: Record<string, number> = {
  wallpaperUrl: 2048,
  panelName: 40,
  panelSubtitle: 60,
  faviconTitle: 60,
  welcomeTitle: 80,
  welcomeMessage: 280,
  maintenanceMessage: 280,
  defaultTemplate: 40,
  smtpHost: 200,
  smtpUser: 200,
  smtpFrom: 200,
  googleClientId: 240,
  googleAllowedEmail: 200,
  panelLogo: 0, // mediumtext — no cap here
  faviconLogo: 0,
};

/** Applies a client patch (PanelSettings shape) onto the DB row. Secrets only
 *  change when a non-empty value is sent; they are never echoed back. */
export async function updateSettings(patch: Record<string, unknown>): Promise<PanelSettings> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.mode !== undefined) set.themeMode = patch.mode === "light" ? "light" : "dark";
  if (patch.wallpaperFit !== undefined) {
    const fit = patch.wallpaperFit;
    set.wallpaperFit = fit === "contain" || fit === "tile" || fit === "stretch" ? fit : "cover";
  }
  for (const key of HEX_KEYS) {
    if (patch[key] !== undefined)
      set[key] = toHexColor(patch[key] as string, String((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key]));
  }
  for (const [key, [min, max]] of Object.entries(INT_KEYS)) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) set[key] = clamp(Math.round(value), min, max);
  }
  for (const key of BOOL_KEYS) {
    if (typeof patch[key] === "boolean") set[key] = patch[key];
  }
  for (const [key, max] of Object.entries(STRING_KEYS)) {
    const value = patch[key];
    if (typeof value === "string") set[key] = max > 0 ? value.slice(0, max) : value;
  }
  if (patch.defaultLanguage !== undefined) set.defaultLanguage = parseLanguage(patch.defaultLanguage);
  // Secrets: blank means "keep the stored one".
  if (typeof patch.smtpPass === "string" && patch.smtpPass !== "") set.smtpPass = patch.smtpPass.slice(0, 400);
  if (typeof patch.googleClientSecret === "string" && patch.googleClientSecret !== "")
    set.googleClientSecret = patch.googleClientSecret.slice(0, 400);

  await db.update(panelSettings).set(set).where(eq(panelSettings.id, SETTINGS_ID));
  return getSettings();
}

// ── DTO mapping ─────────────────────────────────────────────────────────────

export function toProfile(row: UserRow, now = Date.now()): PanelProfile {
  const lastSeen = iso(row.lastSeen);
  return {
    userId: row.id,
    username: row.username,
    email: row.email,
    role: row.role === "owner" || row.role === "admin" ? row.role : "member",
    status: row.status === "suspended" ? "suspended" : "active",
    bio: row.bio,
    profilePic: row.profilePic,
    lastSeen,
    lastLoginAt: iso(row.lastLoginAt),
    createdAt: row.createdAt.toISOString(),
    online: !!row.lastSeen && now - row.lastSeen.getTime() < ONLINE_WINDOW_MS,
  };
}

export function toServerDto(row: ServerRow, ownerName: string | null): ServerDto {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    status:
      row.status === "running" || row.status === "starting" || row.status === "stopping" ? row.status : "offline",
    startedAt: iso(row.startedAt),
    node: row.node,
    ip: row.ip,
    port: row.port,
    cpuLimit: row.cpuLimit,
    memoryMb: row.memoryMb,
    diskMb: row.diskMb,
    ownerId: row.ownerId,
    ownerName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listServers(): Promise<ServerDto[]> {
  const db = getDb();
  const rows = await db.select().from(servers);
  const ownerRows = await db.select().from(users);
  const names = new Map(ownerRows.map((u) => [u.id, u.username]));
  return rows
    .map((row) => toServerDto(row, row.ownerId ? (names.get(row.ownerId) ?? null) : null))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listNodes(): Promise<NodeDto[]> {
  const db = getDb();
  const rows = await db.select().from(nodes);
  const counts = await db.select({ node: servers.node, count: sql<number>`count(*)` }).from(servers).groupBy(servers.node);
  const byNode = new Map(counts.map((c) => [c.node, Number(c.count)]));
  return rows
    .map((row) => ({ id: row.id, name: row.name, region: row.region, subnet: row.subnet, serverCount: byNode.get(row.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTeam(): Promise<PanelProfile[]> {
  const rows = await getDb().select().from(users);
  return rows.map((row) => toProfile(row)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function userCount(): Promise<number> {
  const rows = await getDb().select({ count: sql<number>`count(*)` }).from(users);
  return Number(rows[0]?.count ?? 0);
}

// ── Simulated daemon: lazy state advancement ────────────────────────────────

async function addEvent(serverId: string, level: ServerEventDto["level"], message: string, at?: Date) {
  await getDb().insert(serverEvents).values({ serverId, level, message, ...(at ? { createdAt: at } : {}) });
}

/** Moves starting/stopping servers (and creating backups) to their next state
 *  once their transition window has elapsed. Called before every read so all
 *  views agree without a background timer. */
export async function advanceServers(): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const transitional = await db
    .select()
    .from(servers)
    .where(sql`${servers.status} in ('starting','stopping')`);

  for (const server of transitional) {
    const elapsed = now - server.statusChangedAt.getTime();
    const template = getTemplate(server.template);
    if (server.status === "starting" && elapsed >= START_MS) {
      const started = new Date(server.statusChangedAt.getTime() + START_MS);
      await db
        .update(servers)
        .set({ status: "running", startedAt: started })
        .where(and(eq(servers.id, server.id), eq(servers.status, "starting")));
      // Flush the remaining boot lines, time-stamped across the boot window.
      const rest = template.bootLog.slice(2);
      for (let i = 0; i < rest.length; i++) {
        await addEvent(server.id, "info", rest[i], new Date(server.statusChangedAt.getTime() + 2000 + i * 1000));
      }
      await addEvent(server.id, "system", `Server marked as running (${template.name})`, started);
    } else if (server.status === "stopping" && elapsed >= STOP_MS) {
      await db
        .update(servers)
        .set({ status: "offline", startedAt: null })
        .where(and(eq(servers.id, server.id), eq(servers.status, "stopping")));
      const rest = template.stopLog.slice(1);
      for (let i = 0; i < rest.length; i++) {
        await addEvent(server.id, "info", rest[i], new Date(server.statusChangedAt.getTime() + 1000 + i * 900));
      }
      await addEvent(server.id, "system", "Server marked as offline");
    }
  }

  const pendingBackups = await db.select().from(serverBackups).where(eq(serverBackups.status, "creating"));
  for (const backup of pendingBackups) {
    if (now - backup.createdAt.getTime() >= BACKUP_MS) {
      await db
        .update(serverBackups)
        .set({ status: "ready" })
        .where(and(eq(serverBackups.id, backup.id), eq(serverBackups.status, "creating")));
    }
  }
}

export async function getServerRow(id: string): Promise<ServerRow | null> {
  const rows = await getDb().select().from(servers).where(eq(servers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function serverDetail(id: string): Promise<{ server: ServerDto; events: ServerEventDto[] } | null> {
  const db = getDb();
  const row = await getServerRow(id);
  if (!row) return null;
  const owner = row.ownerId
    ? (await db.select().from(users).where(eq(users.id, row.ownerId)).limit(1))[0]
    : null;
  const events = await db
    .select()
    .from(serverEvents)
    .where(eq(serverEvents.serverId, id))
    .orderBy(desc(serverEvents.id))
    .limit(200);
  return {
    server: toServerDto(row, owner?.username ?? null),
    events: events
      .map((e) => ({
        id: e.id,
        level: (["info", "warn", "error", "cmd", "system"].includes(e.level) ? e.level : "info") as ServerEventDto["level"],
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      }))
      .reverse(),
  };
}

// ── Sessions ────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newId("ses", 24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, token));
}

export async function destroyUserSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

/** Resolves a session token to a live user, refreshing lastSeen at most once a minute. */
export async function resolveSession(token: string): Promise<UserRow | null> {
  const db = getDb();
  const rows = await db.select().from(sessions).where(eq(sessions.id, token)).limit(1);
  const session = rows[0];
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;
  if (!user.lastSeen || Date.now() - user.lastSeen.getTime() > 60_000) {
    await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, user.id));
    user.lastSeen = new Date();
  }
  return user;
}

// ── Misc helpers ────────────────────────────────────────────────────────────

export { newId, isAdminRole, seededNumber };
