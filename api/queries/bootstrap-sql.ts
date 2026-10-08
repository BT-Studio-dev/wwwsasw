/**
 * Idempotent DDL statements for all 13 BT Panel tables and their indexes.
 * Used on first query to initialize either a fresh MySQL database or the
 * embedded SQLite fallback when MySQL is unavailable.
 */
export const MYSQL_BOOTSTRAP_STMTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS \`media_files\` (
    \`id\` varchar(64) NOT NULL,
    \`name\` varchar(120) NOT NULL,
    \`mime\` varchar(80) NOT NULL,
    \`data\` longtext NOT NULL,
    \`created_by\` varchar(64),
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`media_files_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`mounts\` (
    \`id\` varchar(64) NOT NULL,
    \`name\` varchar(64) NOT NULL,
    \`description\` varchar(191) NOT NULL DEFAULT '',
    \`path\` varchar(120) NOT NULL,
    \`target\` varchar(120) NOT NULL DEFAULT '/mnt',
    \`read_only\` boolean NOT NULL DEFAULT false,
    \`user_mountable\` boolean NOT NULL DEFAULT false,
    \`fstype\` varchar(16) NOT NULL DEFAULT 'overlay',
    \`size_gb\` int NOT NULL DEFAULT 100,
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`mounts_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`nests\` (
    \`id\` varchar(64) NOT NULL,
    \`name\` varchar(40) NOT NULL,
    \`description\` varchar(200) NOT NULL DEFAULT '',
    \`egg\` varchar(40) NOT NULL,
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`nests_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`nodes\` (
    \`id\` varchar(64) NOT NULL,
    \`name\` varchar(40) NOT NULL,
    \`region\` varchar(12) NOT NULL DEFAULT 'EU',
    \`subnet\` varchar(24) NOT NULL DEFAULT '10.0.0.',
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`nodes_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`panel_settings\` (
    \`id\` int NOT NULL,
    \`theme_mode\` varchar(16) NOT NULL DEFAULT 'dark',
    \`wallpaper_url\` varchar(2048) NOT NULL DEFAULT 'shader:waves',
    \`bg_blur\` int NOT NULL DEFAULT 0,
    \`bg_opacity\` int NOT NULL DEFAULT 100,
    \`wallpaper_fit\` varchar(16) NOT NULL DEFAULT 'cover',
    \`wallpaper_zoom\` int NOT NULL DEFAULT 100,
    \`accent_color\` varchar(16) NOT NULL DEFAULT '#3b82f6',
    \`glass_tint\` varchar(16) NOT NULL DEFAULT '#0c1424',
    \`nav_text\` varchar(16) NOT NULL DEFAULT '#9da3b4',
    \`nav_text_active\` varchar(16) NOT NULL DEFAULT '#e7e9f0',
    \`glass_blur\` int NOT NULL DEFAULT 20,
    \`glass_saturate\` int NOT NULL DEFAULT 160,
    \`border_radius\` int NOT NULL DEFAULT 16,
    \`glass_opacity\` int NOT NULL DEFAULT 62,
    \`show_team\` boolean NOT NULL DEFAULT true,
    \`panel_name\` varchar(40) NOT NULL DEFAULT 'BT Panel',
    \`panel_subtitle\` varchar(60) NOT NULL DEFAULT 'Command center',
    \`favicon_title\` varchar(60) NOT NULL DEFAULT 'BT Panel',
    \`panel_logo\` mediumtext NOT NULL,
    \`favicon_logo\` mediumtext NOT NULL,
    \`welcome_title\` varchar(80) NOT NULL DEFAULT 'Welcome',
    \`welcome_message\` varchar(280) NOT NULL DEFAULT 'Manage your panel from one place.',
    \`show_admin_stats\` boolean NOT NULL DEFAULT true,
    \`show_version\` boolean NOT NULL DEFAULT true,
    \`show_role\` boolean NOT NULL DEFAULT true,
    \`show_header_user\` boolean NOT NULL DEFAULT true,
    \`allow_registration\` boolean NOT NULL DEFAULT true,
    \`tutorials_enabled\` boolean NOT NULL DEFAULT true,
    \`password_reset_enabled\` boolean NOT NULL DEFAULT true,
    \`default_language\` varchar(12) NOT NULL DEFAULT 'en',
    \`require_two_factor\` boolean NOT NULL DEFAULT false,
    \`maintenance_mode\` boolean NOT NULL DEFAULT false,
    \`maintenance_message\` varchar(280) NOT NULL DEFAULT '',
    \`max_servers_per_user\` int NOT NULL DEFAULT 10,
    \`default_template\` varchar(40) NOT NULL DEFAULT 'minecraft',
    \`backup_retention\` int NOT NULL DEFAULT 5,
    \`debug_logging\` boolean NOT NULL DEFAULT false,
    \`smtp_host\` varchar(200) NOT NULL DEFAULT '',
    \`smtp_port\` int NOT NULL DEFAULT 587,
    \`smtp_secure\` boolean NOT NULL DEFAULT false,
    \`smtp_user\` varchar(200) NOT NULL DEFAULT '',
    \`smtp_pass\` varchar(400) NOT NULL DEFAULT '',
    \`smtp_from\` varchar(200) NOT NULL DEFAULT 'BT Panel <no-reply@btpanel.local>',
    \`google_oauth_enabled\` boolean NOT NULL DEFAULT false,
    \`google_client_id\` varchar(240) NOT NULL DEFAULT '',
    \`google_client_secret\` varchar(400) NOT NULL DEFAULT '',
    \`google_allowed_email\` varchar(200) NOT NULL DEFAULT '',
    \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`panel_settings_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`password_reset_tokens\` (
    \`id\` varchar(64) NOT NULL,
    \`user_id\` varchar(64) NOT NULL,
    \`expires_at\` datetime(3) NOT NULL,
    \`used_at\` datetime(3),
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`password_reset_tokens_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
    \`id\` varchar(80) NOT NULL,
    \`applied_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`schema_migrations_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`server_backups\` (
    \`id\` varchar(64) NOT NULL,
    \`server_id\` varchar(64) NOT NULL,
    \`name\` varchar(60) NOT NULL,
    \`size_mb\` int NOT NULL,
    \`status\` varchar(20) NOT NULL DEFAULT 'creating',
    \`created_by\` varchar(64),
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`server_backups_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`server_events\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`server_id\` varchar(64) NOT NULL,
    \`level\` varchar(16) NOT NULL DEFAULT 'info',
    \`message\` text NOT NULL,
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`server_events_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`server_plugins\` (
    \`id\` varchar(64) NOT NULL,
    \`server_id\` varchar(64) NOT NULL,
    \`catalog_id\` varchar(64) NOT NULL,
    \`name\` varchar(120) NOT NULL,
    \`version\` varchar(60) NOT NULL,
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`server_plugins_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`server_plugins_server_catalog_unique\` UNIQUE(\`server_id\`,\`catalog_id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`servers\` (
    \`id\` varchar(64) NOT NULL,
    \`name\` varchar(40) NOT NULL,
    \`template\` varchar(40) NOT NULL,
    \`status\` varchar(20) NOT NULL DEFAULT 'offline',
    \`status_changed_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`started_at\` datetime(3),
    \`node\` varchar(64) NOT NULL,
    \`ip\` varchar(64) NOT NULL,
    \`port\` int NOT NULL,
    \`cpu_limit\` int NOT NULL DEFAULT 200,
    \`memory_mb\` int NOT NULL DEFAULT 4096,
    \`disk_mb\` int NOT NULL DEFAULT 20480,
    \`owner_id\` varchar(64),
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`servers_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`sessions\` (
    \`id\` varchar(64) NOT NULL,
    \`user_id\` varchar(64) NOT NULL,
    \`expires_at\` datetime(3) NOT NULL,
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`sessions_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` varchar(64) NOT NULL,
    \`username\` varchar(24) NOT NULL,
    \`email\` varchar(120) NOT NULL,
    \`password_hash\` varchar(255) NOT NULL,
    \`role\` varchar(16) NOT NULL DEFAULT 'member',
    \`status\` varchar(16) NOT NULL DEFAULT 'active',
    \`bio\` varchar(280) NOT NULL DEFAULT '',
    \`profile_pic\` mediumtext NOT NULL,
    \`totp_secret\` varchar(64),
    \`totp_enabled\` boolean NOT NULL DEFAULT false,
    \`last_seen\` datetime(3),
    \`last_login_at\` datetime(3),
    \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT \`users_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`users_username_unique\` UNIQUE(\`username\`),
    CONSTRAINT \`users_email_unique\` UNIQUE(\`email\`)
  )`,
  `CREATE INDEX \`password_reset_tokens_user_idx\` ON \`password_reset_tokens\` (\`user_id\`)`,
  `CREATE INDEX \`server_backups_server_idx\` ON \`server_backups\` (\`server_id\`,\`created_at\`)`,
  `CREATE INDEX \`server_events_server_idx\` ON \`server_events\` (\`server_id\`,\`created_at\`)`,
  `CREATE INDEX \`servers_owner_idx\` ON \`servers\` (\`owner_id\`)`,
  `CREATE INDEX \`sessions_user_idx\` ON \`sessions\` (\`user_id\`)`,
];

export function toSqliteBootstrapSql(stmt: string): string {
  return stmt
    .replace(/^CREATE INDEX `/i, "CREATE INDEX IF NOT EXISTS `")
    .replace(/DEFAULT CURRENT_TIMESTAMP\(3\)/gi, "DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))")
    .replace(/`id`\s+int\s+AUTO_INCREMENT\s+NOT\s+NULL/i, "`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL")
    .replace(/,\s*CONSTRAINT `server_events_id` PRIMARY KEY\(`id`\)/i, "");
}
