import "dotenv/config";

function optional(name: string, fallback = ""): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  appId: optional("APP_ID", "bt-panel"),
  appSecret: optional("APP_SECRET", "bt-panel-secret"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: optional("DATABASE_URL", ""),
};
