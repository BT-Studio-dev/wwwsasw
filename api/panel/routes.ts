import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  mediaFiles,
  mounts,
  nests,
  nodes,
  passwordResetTokens,
  serverBackups,
  serverEvents,
  serverPlugins,
  servers,
  sessions,
  users,
} from "@db/schema";
import { consoleReply, getTemplate, PAPER_PLUGINS, SERVER_TEMPLATES } from "@contracts/panel/catalog";
import { isAdminRole, type BootstrapPayload } from "@contracts/panel/types";
import { clamp } from "@contracts/utils";
import {
  advanceServers,
  createSession,
  destroySession,
  destroyUserSessions,
  getServerRow,
  getSettings,
  getSettingsRow,
  listNodes,
  listServers,
  listTeam,
  resolveSession,
  serverDetail,
  toProfile,
  toServerDto,
  updateSettings,
  userCount,
} from "./store";
import { hashPassword, newId, newTotpSecret, seededNumber, totpUri, verifyPassword, verifyTotp } from "./util";
import { pterodactylApi } from "../pterodactyl/routes";

const SESSION_COOKIE = "btp_session";
const SESSION_MAX_AGE = 30 * 24 * 3600;

type AuthedUser = typeof users.$inferSelect;

export const panelApi = new Hono<{ Bindings: HttpBindings; Variables: { user: AuthedUser; sessionToken: string } }>();

// ── Helpers ─────────────────────────────────────────────────────────────────

function fail(status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string) {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

panelApi.onError((err, c) => {
  const status = (err as { status?: number }).status ?? 500;
  if (status === 500) console.error("[bt-panel] api error", err);
  return c.json({ error: err.message || "Something went wrong." }, status as 400);
});

/** CSRF: every state-changing request must carry the custom header (the SPA always sends it). */
panelApi.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-btp-csrf") !== "1") {
    return c.json({ error: "Missing CSRF header." }, 403);
  }
  return next();
});

async function body<T = Record<string, unknown>>(c: { req: { json: () => Promise<unknown> } }): Promise<T> {
  try {
    const data = (await c.req.json()) as T;
    return data ?? ({} as T);
  } catch {
    throw fail(400, "Invalid request body.");
  }
}

function bearerToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const header = c.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function currentUser(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<{ user: AuthedUser; token: string } | null> {
  const token = bearerToken(c) ?? getCookie(c as never, SESSION_COOKIE) ?? null;
  if (!token) return null;
  const user = await resolveSession(token);
  return user ? { user, token } : null;
}

function isSecureRequest(c: { req: { header: (name: string) => string | undefined; url: string } }): boolean {
  const proto = c.req.header("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(c.req.url).protocol === "https:";
}

function writeSessionCookie(c: never, token: string, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    sameSite: secure ? "None" : "Lax",
    secure,
    ...(secure ? { partitioned: true } : {}),
  });
}

async function buildBootstrap(user: AuthedUser): Promise<BootstrapPayload> {
  await advanceServers();
  const [settings, team, serverList, nodeList, count] = await Promise.all([
    getSettings(),
    listTeam(),
    listServers(),
    listNodes(),
    userCount(),
  ]);
  return {
    profile: { ...toProfile(user), online: true },
    settings,
    team,
    servers: serverList,
    nodes: nodeList,
    userCount: count,
  };
}

/** Require a signed-in user; honours maintenance mode for non-admins. */
panelApi.use("*", async (c, next) => {
  const open =
    c.req.path === "/api/health" ||
    c.req.path === "/api/public-settings" ||
    c.req.path.startsWith("/api/auth/") ||
    c.req.path.startsWith("/api/media/");
  if (open) return next();

  const session = await currentUser(c);
  if (!session) throw fail(401, "Your session has expired. Please sign in again.");
  const settings = await getSettings();
  if (settings.maintenanceMode && !isAdminRole(session.user.role)) {
    throw fail(503, settings.maintenanceMessage || "The panel is in maintenance mode. Please check back soon.");
  }
  c.set("user", session.user);
  c.set("sessionToken", session.token);
  return next();
});

function requireAdmin(user: AuthedUser) {
  if (!isAdminRole(user.role)) throw fail(403, "Administrator access required.");
}

// ── Health & public settings ────────────────────────────────────────────────

panelApi.get("/health", (c) => c.json({ ok: true, service: "bt-panel", ts: new Date().toISOString() }));

panelApi.get("/public-settings", async (c) => {
  const settings = await getSettings();
  const firstUser = (await userCount()) === 0;
  return c.json({
    theme: {
      mode: settings.mode,
      wallpaperUrl: settings.wallpaperUrl,
      bgBlur: settings.bgBlur,
      bgOpacity: settings.bgOpacity,
      wallpaperFit: settings.wallpaperFit,
      wallpaperZoom: settings.wallpaperZoom,
      accentColor: settings.accentColor,
      glassTint: settings.glassTint,
      navText: settings.navText,
      navTextActive: settings.navTextActive,
      glassBlur: settings.glassBlur,
      glassSaturate: settings.glassSaturate,
      borderRadius: settings.borderRadius,
      glassOpacity: settings.glassOpacity,
    },
    panelName: settings.panelName,
    panelLogo: settings.panelLogo,
    allowRegistration: settings.allowRegistration,
    passwordResetEnabled: settings.passwordResetEnabled,
    firstUser,
    google: {
      googleOauthEnabled: settings.googleOauthEnabled && !!settings.googleClientId,
      googleClientId: settings.googleOauthEnabled ? settings.googleClientId : "",
    },
  });
});

// ── Auth ────────────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function findByIdentifier(identifier: string): Promise<AuthedUser | null> {
  const db = getDb();
  const needle = identifier.trim().toLowerCase();
  if (!needle) return null;
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${needle} or lower(${users.email}) = ${needle}`)
    .limit(1);
  return rows[0] ?? null;
}

panelApi.post("/auth/register", async (c) => {
  const { username, email, password } = await body<{ username?: string; email?: string; password?: string }>(c);
  const name = (username ?? "").trim();
  const mail = (email ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(name)) throw fail(400, "Usernames are 3–24 characters: letters, numbers, dots, dashes, underscores.");
  if (!EMAIL_RE.test(mail)) throw fail(400, "Enter a valid email address.");
  if (!password || password.length < 8) throw fail(400, "Password must be at least 8 characters.");

  const db = getDb();
  const count = await userCount();
  const settings = await getSettings();
  const firstUser = count === 0;
  if (!firstUser && !settings.allowRegistration) {
    throw fail(403, "Registration is closed on this panel. Ask an administrator for an account.");
  }
  const clash = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(sql`lower(${users.username}) = ${name.toLowerCase()} or lower(${users.email}) = ${mail}`)
    .limit(1);
  if (clash[0]) {
    throw fail(409, clash[0].username.toLowerCase() === name.toLowerCase() ? "That username is taken." : "That email is already registered.");
  }

  const id = newId("usr");
  await db.insert(users).values({
    id,
    username: name,
    email: mail,
    passwordHash: hashPassword(password),
    role: firstUser ? "owner" : "member",
    profilePic: "",
    lastSeen: new Date(),
    lastLoginAt: new Date(),
  });
  const user = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  const { token } = await createSession(id);
  writeSessionCookie(c as never, token, isSecureRequest(c));
  return c.json({ ok: true, token, panel: await buildBootstrap(user) });
});

panelApi.post("/auth/login", async (c) => {
  const { identifier, password, code } = await body<{ identifier?: string; password?: string; code?: string }>(c);
  const user = await findByIdentifier(identifier ?? "");
  const invalid = "Invalid username or email, or wrong password.";
  if (!user || !password || !verifyPassword(password, user.passwordHash)) throw fail(401, invalid);
  if (user.status === "suspended") throw fail(403, "This account has been suspended. Contact an administrator.");

  const settings = await getSettings();
  if (settings.maintenanceMode && !isAdminRole(user.role)) {
    throw fail(503, settings.maintenanceMessage || "The panel is in maintenance mode. Please check back soon.");
  }
  if (user.totpEnabled && user.totpSecret) {
    if (!code) throw fail(401, "Two-factor code required.");
    if (!verifyTotp(user.totpSecret, code)) throw fail(401, "Incorrect two-factor code.");
  } else if (settings.requireTwoFactor && user.role === "admin") {
    throw fail(403, "This panel requires two-factor authentication for administrators. Ask the owner to relax the policy or enable 2FA first.");
  }

  const db = getDb();
  await db.update(users).set({ lastSeen: new Date(), lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const fresh = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
  const { token } = await createSession(user.id);
  writeSessionCookie(c as never, token, isSecureRequest(c));
  return c.json({ ok: true, token, panel: await buildBootstrap(fresh) });
});

panelApi.post("/auth/logout", async (c) => {
  const session = await currentUser(c);
  if (session) await destroySession(session.token);
  deleteCookie(c as never, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

panelApi.post("/auth/forgot", async (c) => {
  const { identifier } = await body<{ identifier?: string }>(c);
  const settings = await getSettings();
  if (!settings.passwordResetEnabled) {
    throw fail(403, "Self-service password reset is disabled. Ask an administrator to reset your password.");
  }
  const message = "If an account exists for that email, a reset link is on its way.";
  const user = await findByIdentifier(identifier ?? "");
  if (!user) return c.json({ ok: true, message });

  const db = getDb();
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  const token = newId("rst", 24);
  await db.insert(passwordResetTokens).values({
    id: token,
    userId: user.id,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  // No SMTP transport is configured on this deployment: hand the link back as a
  // dev preview, which the UI renders when present.
  return c.json({ ok: true, message, previewUrl: `/reset?token=${encodeURIComponent(token)}` });
});

panelApi.post("/auth/reset", async (c) => {
  const { token, password } = await body<{ token?: string; password?: string }>(c);
  if (!token) throw fail(400, "This reset link is missing a token.");
  if (!password || password.length < 8) throw fail(400, "Password must be at least 8 characters.");
  const db = getDb();
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, token)).limit(1);
  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw fail(400, "This reset link has expired. Request a new one.");
  }
  await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, row.userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId));
  await destroyUserSessions(row.userId); // password change signs out every device
  return c.json({ ok: true });
});

// ── Google OAuth (only active when an admin configures it) ──────────────────

panelApi.get("/auth/google/start", async (c) => {
  const row = await getSettingsRow();
  if (!row.googleOauthEnabled || !row.googleClientId || !row.googleClientSecret) {
    return c.redirect("/login?google_error=not_configured");
  }
  const origin = new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: row.googleClientId,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

panelApi.get("/auth/google/callback", async (c) => {
  const row = await getSettingsRow();
  const failRedirect = (reason: string) => c.redirect(`/login?google_error=${encodeURIComponent(reason)}`);
  try {
    const code = new URL(c.req.url).searchParams.get("code");
    if (!code || !row.googleOauthEnabled || !row.googleClientId || !row.googleClientSecret) {
      return failRedirect("not_configured");
    }
    const origin = new URL(c.req.url).origin;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: row.googleClientId,
        client_secret: row.googleClientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return failRedirect("token_exchange_failed");
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!infoRes.ok) return failRedirect("profile_fetch_failed");
    const info = (await infoRes.json()) as { email?: string; name?: string };
    const email = (info.email ?? "").toLowerCase();
    if (!email) return failRedirect("no_email");
    if (row.googleAllowedEmail && row.googleAllowedEmail.toLowerCase() !== email) {
      return failRedirect("email_not_allowed");
    }

    const db = getDb();
    let user = (await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];
    if (!user) {
      const count = await userCount();
      if (count > 0 && !row.allowRegistration) return failRedirect("registration_closed");
      const base = email.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 20) || "user";
      let username = base;
      for (let i = 1; ; i++) {
        const clash = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${username.toLowerCase()}`).limit(1);
        if (!clash[0]) break;
        username = `${base}${i}`.slice(0, 24);
      }
      const id = newId("usr");
      await db.insert(users).values({
        id,
        username,
        email,
        passwordHash: hashPassword(newId("google", 12)), // password login disabled in practice
        role: count === 0 ? "owner" : "member",
        profilePic: "",
        lastSeen: new Date(),
        lastLoginAt: new Date(),
      });
      user = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    }
    if (user.status === "suspended") return failRedirect("account_suspended");
    const { token } = await createSession(user.id);
    writeSessionCookie(c as never, token, isSecureRequest(c));
    return c.redirect("/");
  } catch (err) {
    console.error("[bt-panel] google oauth failed", err);
    return failRedirect("oauth_failed");
  }
});

// ── Bootstrap & live panel data ─────────────────────────────────────────────

panelApi.get("/bootstrap", async (c) => {
  return c.json(await buildBootstrap(c.get("user")));
});

panelApi.get("/panel", async (c) => {
  await advanceServers();
  const [team, serverList, nodeList, count] = await Promise.all([listTeam(), listServers(), listNodes(), userCount()]);
  return c.json({ team, servers: serverList, nodes: nodeList, userCount: count });
});

// ── Settings (admin) ────────────────────────────────────────────────────────

panelApi.get("/settings", async (c) => {
  requireAdmin(c.get("user"));
  return c.json({ settings: await getSettings() });
});

panelApi.put("/settings", async (c) => {
  requireAdmin(c.get("user"));
  const patch = await body(c);
  const settings = await updateSettings(patch);
  return c.json({ settings });
});

panelApi.patch("/settings", async (c) => {
  requireAdmin(c.get("user"));
  const patch = await body(c);
  const settings = await updateSettings(patch);
  return c.json({ settings });
});

// ── Account (session) ───────────────────────────────────────────────────────

panelApi.patch("/account", async (c) => {
  const user = c.get("user");
  const patch = await body<{ username?: string; bio?: string; profilePic?: string }>(c);
  const db = getDb();
  const set: Record<string, unknown> = {};

  if (patch.username !== undefined) {
    const name = patch.username.trim();
    if (!USERNAME_RE.test(name)) throw fail(400, "Usernames are 3–24 characters: letters, numbers, dots, dashes, underscores.");
    const clash = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${name.toLowerCase()} and ${users.id} <> ${user.id}`)
      .limit(1);
    if (clash[0]) throw fail(409, "That username is taken.");
    set.username = name;
  }
  if (patch.bio !== undefined) set.bio = String(patch.bio).slice(0, 280);
  if (patch.profilePic !== undefined) {
    const pic = String(patch.profilePic);
    if (pic && !pic.startsWith("data:image/")) throw fail(400, "Profile photos must be image data URLs.");
    set.profilePic = pic;
  }
  if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, user.id));
  const fresh = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
  return c.json({ profile: toProfile(fresh) });
});

panelApi.post("/account/password", async (c) => {
  const user = c.get("user");
  const { currentPassword, newPassword } = await body<{ currentPassword?: string; newPassword?: string }>(c);
  if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
    throw fail(401, "Your current password is incorrect.");
  }
  if (!newPassword || newPassword.length < 8) throw fail(400, "New password must be at least 8 characters.");
  const db = getDb();
  await db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id));
  // Sign out every other device; this session survives.
  const token = c.get("sessionToken");
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), sql`${sessions.id} <> ${token}`));
  return c.json({ ok: true });
});

panelApi.get("/account/totp", async (c) => {
  return c.json({ enabled: c.get("user").totpEnabled });
});

panelApi.post("/account/totp", async (c) => {
  const user = c.get("user");
  const { action, code } = await body<{ action?: string; code?: string }>(c);
  const db = getDb();
  const settings = await getSettings();

  if (!action) {
    // Step 1: issue a secret — nothing is enabled until a code verifies.
    const secret = newTotpSecret();
    await db.update(users).set({ totpSecret: secret, totpEnabled: false }).where(eq(users.id, user.id));
    return c.json({ secret, uri: totpUri(secret, user.username, settings.panelName || "BT Panel") });
  }
  if (action === "confirm") {
    const fresh = (await db.select().from(users).where(eq(users.id, user.id)).limit(1))[0];
    if (!fresh.totpSecret) throw fail(400, "Start enrolment first to get a secret.");
    if (!code || !verifyTotp(fresh.totpSecret, code)) throw fail(400, "That code was not accepted. Check the time on your device and try again.");
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
    return c.json({ ok: true });
  }
  if (action === "disable") {
    if (settings.requireTwoFactor && user.role === "admin") {
      throw fail(403, "This panel requires administrators to keep two-factor authentication on.");
    }
    await db.update(users).set({ totpEnabled: false, totpSecret: null }).where(eq(users.id, user.id));
    return c.json({ ok: true });
  }
  throw fail(400, "Unknown two-factor action.");
});

// ── User management (admin) ─────────────────────────────────────────────────

function canManage(actor: AuthedUser, target: AuthedUser): boolean {
  return target.id !== actor.id && target.role !== "owner" && (actor.role === "owner" || target.role !== "admin");
}

panelApi.get("/users", async (c) => {
  requireAdmin(c.get("user"));
  return c.json({ team: await listTeam() });
});

panelApi.post("/users", async (c) => {
  const actor = c.get("user");
  requireAdmin(actor);
  const { username, email, password, role } = await body<{ username?: string; email?: string; password?: string; role?: string }>(c);
  const name = (username ?? "").trim();
  const mail = (email ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(name)) throw fail(400, "Usernames are 3–24 characters: letters, numbers, dots, dashes, underscores.");
  if (!EMAIL_RE.test(mail)) throw fail(400, "Enter a valid email address.");
  if (!password || password.length < 8) throw fail(400, "Password must be at least 8 characters.");
  const finalRole = role === "admin" && actor.role === "owner" ? "admin" : "member";

  const db = getDb();
  const clash = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(sql`lower(${users.username}) = ${name.toLowerCase()} or lower(${users.email}) = ${mail}`)
    .limit(1);
  if (clash[0]) {
    throw fail(409, clash[0].username.toLowerCase() === name.toLowerCase() ? "That username is taken." : "That email is already registered.");
  }
  await db.insert(users).values({
    id: newId("usr"),
    username: name,
    email: mail,
    passwordHash: hashPassword(password),
    role: finalRole,
    profilePic: "",
  });
  return c.json({ team: await listTeam() });
});

panelApi.patch("/users/:id", async (c) => {
  const actor = c.get("user");
  requireAdmin(actor);
  const db = getDb();
  const target = (await db.select().from(users).where(eq(users.id, c.req.param("id"))).limit(1))[0];
  if (!target) throw fail(404, "User not found.");
  if (!canManage(actor, target)) throw fail(403, "You cannot manage that account.");

  const patch = await body<{ role?: string; status?: string }>(c);
  const set: Record<string, unknown> = {};
  if (patch.role !== undefined) {
    if (actor.role !== "owner") throw fail(403, "Only the owner can change roles.");
    set.role = patch.role === "admin" ? "admin" : "member";
  }
  if (patch.status !== undefined) {
    set.status = patch.status === "suspended" ? "suspended" : "active";
    if (set.status === "suspended") await destroyUserSessions(target.id);
  }
  if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, target.id));
  return c.json({ team: await listTeam() });
});

panelApi.delete("/users/:id", async (c) => {
  const actor = c.get("user");
  requireAdmin(actor);
  const db = getDb();
  const target = (await db.select().from(users).where(eq(users.id, c.req.param("id"))).limit(1))[0];
  if (!target) throw fail(404, "User not found.");
  if (!canManage(actor, target)) throw fail(403, "You cannot manage that account.");
  await db.delete(users).where(eq(users.id, target.id));
  return c.json({ team: await listTeam() });
});

// ── Servers ─────────────────────────────────────────────────────────────────

async function loadServerFor(user: AuthedUser, id: string) {
  await advanceServers();
  const row = await getServerRow(id);
  if (!row) throw fail(404, "Server not found.");
  if (!isAdminRole(user.role) && row.ownerId !== user.id) throw fail(403, "That server belongs to another user.");
  return row;
}

async function logEvent(serverId: string, level: "info" | "warn" | "error" | "cmd" | "system", message: string) {
  await getDb().insert(serverEvents).values({ serverId, level, message });
}

panelApi.get("/servers", async (c) => {
  await advanceServers();
  return c.json({ servers: await listServers() });
});

panelApi.post("/servers", async (c) => {
  const user = c.get("user");
  const payload = await body<{
    name?: string;
    template?: string;
    node?: string;
    cpuLimit?: number;
    memoryMb?: number;
    diskMb?: number;
  }>(c);
  const name = (payload.name ?? "").trim();
  if (name.length < 2 || name.length > 40) throw fail(400, "Server names are 2–40 characters.");
  const template = SERVER_TEMPLATES.find((t) => t.id === payload.template);
  if (!template) throw fail(400, "Unknown server template.");

  const db = getDb();
  const nodeRow = (await db.select().from(nodes).where(eq(nodes.id, payload.node ?? "")).limit(1))[0];
  if (!nodeRow) throw fail(400, "Choose a node to place the server on.");

  const settings = await getSettings();
  if (!isAdminRole(user.role) && settings.maxServersPerUser > 0) {
    const mine = await db
      .select({ count: sql<number>`count(*)` })
      .from(servers)
      .where(eq(servers.ownerId, user.id));
    if (Number(mine[0]?.count ?? 0) >= settings.maxServersPerUser) {
      throw fail(403, `You can own at most ${settings.maxServersPerUser} servers on this panel.`);
    }
  }

  const onNode = await db.select({ count: sql<number>`count(*)` }).from(servers).where(eq(servers.node, nodeRow.id));
  const octet = 2 + (Number(onNode[0]?.count ?? 0) % 200);
  const id = newId("srv", 8);
  await db.insert(servers).values({
    id,
    name,
    template: template.id,
    status: "offline",
    node: nodeRow.id,
    ip: `${nodeRow.subnet}${octet}`,
    port: template.defaultPort,
    cpuLimit: clamp(Math.round(payload.cpuLimit ?? 200), 50, 800),
    memoryMb: clamp(Math.round(payload.memoryMb ?? 4096), 512, 16384),
    diskMb: clamp(Math.round(payload.diskMb ?? 20480), 1024, 102400),
    ownerId: user.id,
  });
  await logEvent(id, "system", `Server record created in BT Panel by ${user.username} — attach a Wings daemon to provision it for real.`);
  const row = await getServerRow(id);
  return c.json({ server: toServerDto(row!, user.username) });
});

panelApi.get("/servers/:id", async (c) => {
  const row = await loadServerFor(c.get("user"), c.req.param("id"));
  const snapshot = await serverDetail(row.id);
  return c.json(snapshot);
});

panelApi.patch("/servers/:id", async (c) => {
  const user = c.get("user");
  const row = await loadServerFor(user, c.req.param("id"));
  const patch = await body<{ name?: string }>(c);
  const name = (patch.name ?? "").trim();
  if (name.length < 2 || name.length > 40) throw fail(400, "Server names are 2–40 characters.");
  await getDb().update(servers).set({ name }).where(eq(servers.id, row.id));
  await logEvent(row.id, "system", `Server renamed to "${name}" by ${user.username}`);
  const fresh = await getServerRow(row.id);
  const ownerName = fresh!.ownerId
    ? ((await getDb().select().from(users).where(eq(users.id, fresh!.ownerId)).limit(1))[0]?.username ?? null)
    : null;
  return c.json({ server: toServerDto(fresh!, ownerName) });
});

panelApi.post("/servers/:id", async (c) => {
  const user = c.get("user");
  const row = await loadServerFor(user, c.req.param("id"));
  const payload = await body<{ type?: string; action?: string; command?: string }>(c);
  const db = getDb();
  const template = getTemplate(row.template);

  if (payload.type === "power") {
    const action = payload.action;
    const now = new Date();
    if (action === "start") {
      if (row.status !== "offline") throw fail(400, "Only an offline server can be started.");
      await db.update(servers).set({ status: "starting", statusChangedAt: now, startedAt: null }).where(eq(servers.id, row.id));
      await logEvent(row.id, "system", `Start requested by ${user.username}`);
      for (const line of template.bootLog.slice(0, 2)) await logEvent(row.id, "info", line);
    } else if (action === "stop") {
      if (row.status !== "running" && row.status !== "starting") throw fail(400, "Only a running server can be stopped.");
      await db.update(servers).set({ status: "stopping", statusChangedAt: now }).where(eq(servers.id, row.id));
      await logEvent(row.id, "system", `Stop requested by ${user.username}`);
      await logEvent(row.id, "info", template.stopLog[0]);
    } else if (action === "restart") {
      if (row.status !== "running") throw fail(400, "Only a running server can be restarted.");
      await db.update(servers).set({ status: "starting", statusChangedAt: now, startedAt: null }).where(eq(servers.id, row.id));
      await logEvent(row.id, "system", `Restart requested by ${user.username}`);
      await logEvent(row.id, "info", "container@bt-panel~ Server marked as restarting...");
    } else if (action === "kill") {
      if (row.status === "offline") throw fail(400, "That server is already offline.");
      await db.update(servers).set({ status: "offline", statusChangedAt: now, startedAt: null }).where(eq(servers.id, row.id));
      await logEvent(row.id, "system", `Kill requested by ${user.username} — server marked as offline`);
    } else {
      throw fail(400, "Unknown power action.");
    }
    return c.json(await serverDetail(row.id));
  }

  if (payload.type === "command") {
    if (row.status !== "running") throw fail(400, "Start the server to use its console.");
    const command = String(payload.command ?? "").trim().slice(0, 200);
    if (!command) throw fail(400, "Enter a command first.");
    await logEvent(row.id, "cmd", `> ${command}`);
    for (const reply of consoleReply(row.template, command)) await logEvent(row.id, reply.level, reply.message);
    return c.json(await serverDetail(row.id));
  }

  throw fail(400, "Unknown server action.");
});

panelApi.patch("/servers/:id/owner", async (c) => {
  const actor = c.get("user");
  requireAdmin(actor);
  const row = await getServerRow(c.req.param("id"));
  if (!row) throw fail(404, "Server not found.");
  const { ownerId } = await body<{ ownerId?: string | null }>(c);
  const db = getDb();
  let ownerName: string | null = null;
  if (ownerId) {
    const target = (await db.select().from(users).where(eq(users.id, ownerId)).limit(1))[0];
    if (!target) throw fail(404, "That user no longer exists.");
    if (target.status !== "active") throw fail(400, "Servers can only be assigned to active users.");
    ownerName = target.username;
  }
  await db.update(servers).set({ ownerId: ownerId ?? null }).where(eq(servers.id, row.id));
  await logEvent(row.id, "system", ownerName ? `Ownership transferred to ${ownerName} by ${actor.username}` : `Ownership cleared by ${actor.username}`);
  const fresh = await getServerRow(row.id);
  return c.json({ server: toServerDto(fresh!, ownerName) });
});

// ── Backups ─────────────────────────────────────────────────────────────────

function toBackupDto(row: typeof serverBackups.$inferSelect, creatorName: string | null) {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    sizeMb: row.sizeMb,
    status: (row.status === "ready" ? "ready" : "creating") as "ready" | "creating",
    createdBy: row.createdBy,
    createdByName: creatorName,
    createdAt: row.createdAt.toISOString(),
  };
}

async function listBackups(serverId: string) {
  await advanceServers();
  const db = getDb();
  const rows = await db
    .select()
    .from(serverBackups)
    .where(eq(serverBackups.serverId, serverId))
    .orderBy(desc(serverBackups.createdAt));
  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v))];
  const creators = creatorIds.length
    ? await db.select({ id: users.id, username: users.username }).from(users).where(sql`${users.id} in (${sql.join(creatorIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];
  const names = new Map(creators.map((u) => [u.id, u.username]));
  return rows.map((row) => toBackupDto(row, row.createdBy ? (names.get(row.createdBy) ?? null) : null));
}

panelApi.get("/servers/:id/backups", async (c) => {
  const row = await loadServerFor(c.get("user"), c.req.param("id"));
  return c.json({ backups: await listBackups(row.id) });
});

panelApi.post("/servers/:id/backups", async (c) => {
  const user = c.get("user");
  const row = await loadServerFor(user, c.req.param("id"));
  const { name } = await body<{ name?: string }>(c);
  const label = (name ?? "").trim().slice(0, 60) || `Backup ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const id = newId("bkp", 8);
  const sizeMb = Math.max(64, Math.round(row.diskMb * (0.28 + seededNumber(id, 1000) / 2500)));
  const db = getDb();
  await db.insert(serverBackups).values({ id, serverId: row.id, name: label, sizeMb, status: "creating", createdBy: user.id });
  await logEvent(row.id, "system", `Backup "${label}" started by ${user.username}`);

  const settings = await getSettings();
  if (settings.backupRetention > 0) {
    const all = await listBackups(row.id);
    const excess = all.slice(settings.backupRetention);
    for (const stale of excess) await db.delete(serverBackups).where(eq(serverBackups.id, stale.id));
  }
  const backups = await listBackups(row.id);
  return c.json({ backup: backups.find((b) => b.id === id), backups });
});

panelApi.delete("/servers/:id/backups/:backupId", async (c) => {
  const row = await loadServerFor(c.get("user"), c.req.param("id"));
  const db = getDb();
  await db.delete(serverBackups).where(and(eq(serverBackups.id, c.req.param("backupId")), eq(serverBackups.serverId, row.id)));
  return c.json({ ok: true });
});

panelApi.post("/servers/:id/backups/:backupId", async (c) => {
  const user = c.get("user");
  const row = await loadServerFor(user, c.req.param("id"));
  const db = getDb();
  const backup = (
    await db
      .select()
      .from(serverBackups)
      .where(and(eq(serverBackups.id, c.req.param("backupId")), eq(serverBackups.serverId, row.id)))
      .limit(1)
  )[0];
  if (!backup) throw fail(404, "Backup not found.");
  if (backup.status !== "ready") throw fail(400, "That backup is still being created.");
  if (row.status !== "offline") throw fail(400, "Stop the server before restoring a backup.");
  await logEvent(row.id, "system", `Restoring backup "${backup.name}" (requested by ${user.username})…`);
  await logEvent(row.id, "system", "Restore complete — server remains offline.");
  return c.json(await serverDetail(row.id));
});

// ── Plugins (Paper inventory tracking) ──────────────────────────────────────

function toPluginDto(row: typeof serverPlugins.$inferSelect) {
  return {
    id: row.id,
    serverId: row.serverId,
    catalogId: row.catalogId,
    name: row.name,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

async function listPlugins(serverId: string) {
  const rows = await getDb().select().from(serverPlugins).where(eq(serverPlugins.serverId, serverId)).orderBy(serverPlugins.createdAt);
  return rows.map(toPluginDto);
}

panelApi.get("/servers/:id/plugins", async (c) => {
  const row = await loadServerFor(c.get("user"), c.req.param("id"));
  return c.json({ plugins: await listPlugins(row.id) });
});

panelApi.post("/servers/:id/plugins", async (c) => {
  const row = await loadServerFor(c.get("user"), c.req.param("id"));
  if (row.template !== "minecraft") throw fail(400, "Plugin tracking is only available on Paper servers.");
  const { catalogId } = await body<{ catalogId?: string }>(c);
  const entry = PAPER_PLUGINS.find((p) => p.id === catalogId);
  if (!entry) throw fail(400, "Unknown catalog plugin.");
  const existing = await listPlugins(row.id);
  if (existing.some((p) => p.catalogId === entry.id)) throw fail(409, `${entry.name} is already tracked for this server.`);
  const id = newId("plg", 8);
  await getDb().insert(serverPlugins).values({ id, serverId: row.id, catalogId: entry.id, name: entry.name, version: entry.version });
  const plugins = await listPlugins(row.id);
  return c.json({ plugin: plugins.find((p) => p.id === id), plugins });
});

panelApi.delete("/servers/:id/plugins", async (c) => {
  const row = await loadServerFor(c.get("user"), c.req.param("id"));
  const pluginId = new URL(c.req.url).searchParams.get("pluginId") ?? "";
  await getDb().delete(serverPlugins).where(and(eq(serverPlugins.id, pluginId), eq(serverPlugins.serverId, row.id)));
  return c.json({ plugins: await listPlugins(row.id) });
});

// ── Nodes / Nests / Mounts ──────────────────────────────────────────────────

panelApi.get("/nodes", async (c) => {
  return c.json({ nodes: await listNodes() });
});

panelApi.post("/nodes", async (c) => {
  requireAdmin(c.get("user"));
  const payload = await body<{ name?: string; region?: string; subnet?: string }>(c);
  const name = (payload.name ?? "").trim();
  if (name.length < 2 || name.length > 40) throw fail(400, "Node names are 2–40 characters.");
  const region = ["EU", "US", "APAC", "SA", "AF"].includes(payload.region ?? "") ? payload.region! : "EU";
  const subnet = (payload.subnet ?? "").trim() || "10.0.0.";
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/.test(subnet)) throw fail(400, "Subnets look like 10.80.0. — three octets ending in a dot.");
  const id = newId("nod", 6);
  await getDb().insert(nodes).values({ id, name, region, subnet });
  return c.json({ node: { id, name, region, subnet, serverCount: 0 } });
});

panelApi.delete("/nodes", async (c) => {
  requireAdmin(c.get("user"));
  const { id } = await body<{ id?: string }>(c);
  const db = getDb();
  const row = (await db.select().from(nodes).where(eq(nodes.id, id ?? "")).limit(1))[0];
  if (!row) throw fail(404, "Node not found.");
  const count = await db.select({ count: sql<number>`count(*)` }).from(servers).where(eq(servers.node, row.id));
  if (Number(count[0]?.count ?? 0) > 0) throw fail(400, "Move or delete its servers first.");
  await db.delete(nodes).where(eq(nodes.id, row.id));
  return c.json({ nodes: await listNodes() });
});

panelApi.get("/nests", async (c) => {
  const rows = await getDb().select().from(nests).orderBy(nests.createdAt);
  return c.json({ nests: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, egg: r.egg })) });
});

panelApi.post("/nests", async (c) => {
  requireAdmin(c.get("user"));
  const payload = await body<{ name?: string; description?: string; egg?: string }>(c);
  const name = (payload.name ?? "").trim();
  if (name.length < 2 || name.length > 40) throw fail(400, "Nest names are 2–40 characters.");
  if (!SERVER_TEMPLATES.some((t) => t.id === payload.egg)) throw fail(400, "Choose a service this panel can run.");
  const id = newId("nst", 6);
  const description = (payload.description ?? "").slice(0, 200);
  await getDb().insert(nests).values({ id, name, description, egg: payload.egg! });
  return c.json({ nest: { id, name, description, egg: payload.egg! } });
});

panelApi.delete("/nests", async (c) => {
  requireAdmin(c.get("user"));
  const { id } = await body<{ id?: string }>(c);
  await getDb().delete(nests).where(eq(nests.id, id ?? ""));
  const rows = await getDb().select().from(nests).orderBy(nests.createdAt);
  return c.json({ nests: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, egg: r.egg })) });
});

const FSTYPES = ["overlay", "nfs", "cifs", "ext4", "xfs", "zfs", "btrfs"];

panelApi.get("/mounts", async (c) => {
  const rows = await getDb().select().from(mounts).orderBy(mounts.createdAt);
  return c.json({
    mounts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      path: r.path,
      target: r.target,
      readOnly: r.readOnly,
      userMountable: r.userMountable,
      fstype: r.fstype,
      sizeGb: r.sizeGb,
    })),
  });
});

panelApi.post("/mounts", async (c) => {
  requireAdmin(c.get("user"));
  const payload = await body<{
    name?: string;
    description?: string;
    path?: string;
    target?: string;
    readOnly?: boolean;
    userMountable?: boolean;
    fstype?: string;
    sizeGb?: number;
  }>(c);
  const name = (payload.name ?? "").trim();
  if (name.length < 2 || name.length > 64) throw fail(400, "Mount names are 2–64 characters.");
  const pathValue = (payload.path ?? "").trim();
  if (!pathValue.startsWith("/")) throw fail(400, "The source must be an absolute path on the host.");
  const target = (payload.target ?? "").trim() || "/mnt";
  if (!target.startsWith("/")) throw fail(400, "The target must be an absolute path inside the server.");
  const fstype = FSTYPES.includes(payload.fstype ?? "") ? payload.fstype! : "overlay";
  const sizeGb = clamp(Math.round(payload.sizeGb ?? 100), 1, 100000);
  const id = newId("mnt", 6);
  const description = (payload.description ?? "").slice(0, 191);
  await getDb().insert(mounts).values({
    id,
    name,
    description,
    path: pathValue.slice(0, 120),
    target: target.slice(0, 120),
    readOnly: !!payload.readOnly,
    userMountable: !!payload.userMountable,
    fstype,
    sizeGb,
  });
  return c.json({ mount: { id, name, description, path: pathValue, target, readOnly: !!payload.readOnly, userMountable: !!payload.userMountable, fstype, sizeGb } });
});

panelApi.delete("/mounts", async (c) => {
  requireAdmin(c.get("user"));
  const { id } = await body<{ id?: string }>(c);
  await getDb().delete(mounts).where(eq(mounts.id, id ?? ""));
  const rows = await getDb().select().from(mounts).orderBy(mounts.createdAt);
  return c.json({
    mounts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      path: r.path,
      target: r.target,
      readOnly: r.readOnly,
      userMountable: r.userMountable,
      fstype: r.fstype,
      sizeGb: r.sizeGb,
    })),
  });
});

// ── Media (wallpapers & logos) ──────────────────────────────────────────────

const MEDIA_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);
const MEDIA_MAX_BYTES = 24 * 1024 * 1024;

panelApi.post("/media", async (c) => {
  requireAdmin(c.get("user"));
  const { name, dataUrl } = await body<{ name?: string; dataUrl?: string }>(c);
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl ?? "");
  if (!match) throw fail(400, "Upload must be a base64 data URL.");
  const mime = match[1].toLowerCase();
  if (!MEDIA_MIMES.has(mime)) throw fail(400, "That file type is not supported.");
  const buf = Buffer.from(match[2], "base64");
  if (!buf.length) throw fail(400, "That file appears to be empty.");
  if (buf.length > MEDIA_MAX_BYTES) throw fail(400, "That file is too large.");
  const id = newId("med", 12);
  await getDb()
    .insert(mediaFiles)
    .values({ id, name: (name ?? "upload").slice(0, 120), mime, data: match[2], createdBy: c.get("user").id });
  return c.json({ url: `/api/media/${id}` });
});

// Public read: the login page shows the panel logo before a session exists.
panelApi.get("/media/:id", async (c) => {
  const rows = await getDb().select().from(mediaFiles).where(eq(mediaFiles.id, c.req.param("id"))).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "Not found." }, 404);
  const buf = Buffer.from(row.data, "base64");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(buf.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// Live Pterodactyl resources and limited Application API writes.
panelApi.route("/pterodactyl", pterodactylApi);
