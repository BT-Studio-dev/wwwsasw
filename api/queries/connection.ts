import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql-proxy";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import { hashPassword, newId } from "../panel/util";
import * as schema from "@db/schema";
import * as relations from "@db/relations";
import { MYSQL_BOOTSTRAP_STMTS, toSqliteBootstrapSql } from "./bootstrap-sql";

const fullSchema = { ...schema, ...relations };

export const DEMO_ADMIN_USERNAME = "admin";
export const DEMO_ADMIN_EMAIL = "admin@example.com";
export const DEMO_ADMIN_PASSWORD = "admin1234";

type ProxyResult = { rows: unknown[] };
type QueryExecutor = (sqlText: string, params: unknown[], method: "all" | "execute") => Promise<ProxyResult>;

/**
 * Rewrites MySQL `INSERT INTO ... VALUES (..., default, ...)` statements into
 * SQLite-compatible `INSERT` statements by omitting columns whose value is the
 * bare `default` keyword so SQLite applies each column's table default.
 */
export function rewriteSqliteQuery(sqlText: string): string {
  const match = /^(\s*insert\s+into\s+`[^`]+`\s*)\(([^)]+)\)\s*values\s*\((.+)\)\s*$/is.exec(sqlText);
  if (!match) return sqlText;
  const [, prefix, colPart, valPart] = match;
  const cols = colPart.split(",").map((s) => s.trim());
  const vals = valPart.split(",").map((s) => s.trim());
  if (cols.length !== vals.length) return sqlText;
  const keepCols: string[] = [];
  const keepVals: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    if (vals[i].toLowerCase() !== "default") {
      keepCols.push(cols[i]);
      keepVals.push(vals[i]);
    }
  }
  if (keepCols.length === 0) {
    return `${prefix.trim()} default values`;
  }
  return `${prefix}(${keepCols.join(", ")}) values (${keepVals.join(", ")})`;
}

type SqliteParam = null | number | bigint | string | Uint8Array;

function normalizeSqliteParam(p: unknown): SqliteParam {
  if (p === null || p === undefined) return null;
  if (typeof p === "boolean") return p ? 1 : 0;
  if (p instanceof Date) return p.toISOString().replace("T", " ").replace("Z", "");
  if (typeof p === "number" || typeof p === "bigint" || typeof p === "string" || p instanceof Uint8Array) {
    return p;
  }
  return String(p);
}

function silenceSqliteExperimentalWarning() {
  const orig = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning?.message ?? "";
    const type = typeof args[0] === "string" ? args[0] : (args[0] as { type?: string } | undefined)?.type ?? "";
    if (text.includes("SQLite") || type === "ExperimentalWarning") {
      return;
    }
    return (orig as (...a: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
}

async function seedInitialData(exec: QueryExecutor): Promise<void> {
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  const existingAdmin = await exec(
    "select `id` from `users` where lower(`username`) = ? or lower(`email`) = ? limit 1",
    [DEMO_ADMIN_USERNAME, DEMO_ADMIN_EMAIL],
    "all",
  );
  let adminId: string;
  if (!existingAdmin.rows.length) {
    adminId = newId("usr");
    await exec(
      "insert into `users` (`id`, `username`, `email`, `password_hash`, `role`, `status`, `bio`, `profile_pic`, `totp_enabled`, `last_seen`, `last_login_at`, `created_at`) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        adminId,
        DEMO_ADMIN_USERNAME,
        DEMO_ADMIN_EMAIL,
        hashPassword(DEMO_ADMIN_PASSWORD),
        "owner",
        "active",
        "Default panel owner account",
        "",
        0,
        now,
        now,
        now,
      ],
      "execute",
    );
  } else {
    const firstRow = existingAdmin.rows[0] as unknown[];
    adminId = String(firstRow[0]);
  }

  const existingSettings = await exec("select `id` from `panel_settings` where `id` = ? limit 1", [1], "all");
  if (!existingSettings.rows.length) {
    await exec(
      "insert into `panel_settings` (`id`, `panel_logo`, `favicon_logo`, `updated_at`) values (?, ?, ?, ?)",
      [1, "", "", now],
      "execute",
    );
  }

  const existingNodes = await exec("select `id` from `nodes` limit 1", [], "all");
  if (!existingNodes.rows.length) {
    await exec(
      "insert into `nodes` (`id`, `name`, `region`, `subnet`, `created_at`) values (?, ?, ?, ?, ?)",
      ["nod_eu01", "EU-Central-1", "EU", "10.10.0.", now],
      "execute",
    );
    await exec(
      "insert into `nodes` (`id`, `name`, `region`, `subnet`, `created_at`) values (?, ?, ?, ?, ?)",
      ["nod_us01", "US-East-1", "US", "10.20.0.", now],
      "execute",
    );
  }

  const existingServers = await exec("select `id` from `servers` limit 1", [], "all");
  if (!existingServers.rows.length) {
    const srvId = "srv_demo01";
    await exec(
      "insert into `servers` (`id`, `name`, `template`, `status`, `status_changed_at`, `started_at`, `node`, `ip`, `port`, `cpu_limit`, `memory_mb`, `disk_mb`, `owner_id`, `created_at`) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [srvId, "Survival Realm", "minecraft", "running", now, now, "nod_eu01", "10.10.0.2", 25565, 200, 4096, 20480, adminId, now],
      "execute",
    );
    await exec(
      "insert into `server_events` (`server_id`, `level`, `message`, `created_at`) values (?, ?, ?, ?)",
      [srvId, "system", "Server marked as running (Minecraft Paper)", now],
      "execute",
    );
  }
}

async function createMysqlExecutor(databaseUrl: string): Promise<QueryExecutor> {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectTimeout: 1500,
    connectionLimit: 10,
    timezone: "Z",
  });
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }

  for (const stmt of MYSQL_BOOTSTRAP_STMTS) {
    try {
      await pool.query(stmt);
    } catch {
      // Index may already exist on subsequent boots.
    }
  }

  const exec: QueryExecutor = async (sqlText, params, method) => {
    if (method === "execute") {
      const [result] = await pool.query(sqlText, params);
      const header = result as { insertId?: number; affectedRows?: number };
      return {
        rows: [{ insertId: Number(header?.insertId ?? 0), affectedRows: Number(header?.affectedRows ?? 0) }],
      };
    }
    const [rows] = await pool.query(
      {
        sql: sqlText,
        rowsAsArray: true,
        typeCast(field, next) {
          if (field.type === "TIMESTAMP" || field.type === "DATETIME" || field.type === "DATE") {
            return field.string();
          }
          return next();
        },
      },
      params,
    );
    return { rows: rows as unknown[] };
  };

  await seedInitialData(exec);
  return exec;
}

async function createSqliteExecutor(customPath?: string): Promise<QueryExecutor> {
  silenceSqliteExperimentalWarning();
  const { DatabaseSync } = await import("node:sqlite");

  let dbPath = customPath || path.resolve(process.cwd(), ".data/bt-panel.sqlite");
  let sqlite: InstanceType<typeof DatabaseSync>;
  try {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    sqlite = new DatabaseSync(dbPath);
    sqlite.exec("PRAGMA journal_mode = WAL;");
  } catch {
    dbPath = ":memory:";
    sqlite = new DatabaseSync(":memory:");
  }

  for (const stmt of MYSQL_BOOTSTRAP_STMTS) {
    sqlite.exec(toSqliteBootstrapSql(stmt));
  }

  const exec: QueryExecutor = async (sqlText, params, method) => {
    const query = rewriteSqliteQuery(sqlText);
    const bound = params.map(normalizeSqliteParam);
    const stmt = sqlite.prepare(query);
    if (method === "execute") {
      const res = stmt.run(...bound);
      return {
        rows: [{ insertId: Number(res.lastInsertRowid ?? 0), affectedRows: Number(res.changes ?? 0) }],
      };
    }
    stmt.setReturnArrays(true);
    const rows = stmt.all(...bound) as unknown[];
    return { rows };
  };

  await seedInitialData(exec);
  return exec;
}

let executorPromise: Promise<QueryExecutor> | null = null;

function getExecutor(): Promise<QueryExecutor> {
  if (!executorPromise) {
    executorPromise = (async () => {
      const url = env.databaseUrl.trim();
      if (url.startsWith("sqlite:") || url.startsWith("file:")) {
        const rawPath = url.replace(/^(sqlite|file):(\/\/)?/, "");
        return createSqliteExecutor(rawPath || undefined);
      }
      if (url.startsWith("mysql://") || url.startsWith("mysql2://")) {
        try {
          return await createMysqlExecutor(url);
        } catch (err) {
          const code = (err as { code?: string })?.code || (err as Error)?.message || "unreachable";
          console.warn(
            `[bt-panel] MySQL (${code}) unavailable — falling back to embedded SQLite database (.data/bt-panel.sqlite).`,
          );
          return createSqliteExecutor();
        }
      }
      return createSqliteExecutor();
    })();
  }
  return executorPromise;
}

let instance: ReturnType<typeof drizzle<typeof fullSchema>> | undefined;

export function getDb() {
  if (!instance) {
    instance = drizzle(
      async (sqlText, params, method) => {
        const exec = await getExecutor();
        return exec(sqlText, params, method);
      },
      {
        schema: fullSchema,
      },
    );
  }
  return instance;
}
