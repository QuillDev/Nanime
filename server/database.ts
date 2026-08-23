import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { resolve } from "node:path";

const DATABASE_PATH = resolve(
  process.env["NANIME_DATABASE"] ?? resolve(import.meta.dir, "..", ".nanime.sqlite"),
);
const ADMIN_SETUP_TOKEN = process.env["NANIME_ADMIN_SETUP_TOKEN"] ?? "";

interface TableColumn {
  readonly name: string;
}

interface AdminSetupState {
  readonly password_hash: string | null;
  readonly setup_token_hash: string | null;
}

export const database = new Database(DATABASE_PATH, { create: true });
chmodSync(DATABASE_PATH, 0o600);
database.run("PRAGMA journal_mode = WAL");
database.run("PRAGMA synchronous = NORMAL");
database.run("PRAGMA foreign_keys = ON");
database.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    setup_token_hash TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`);
const userColumns = database.query<TableColumn, []>("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "setup_token_hash")) {
  database.run("ALTER TABLE users ADD COLUMN setup_token_hash TEXT");
}
if (ADMIN_SETUP_TOKEN !== "" && ADMIN_SETUP_TOKEN.length < 32) {
  throw new Error("NANIME_ADMIN_SETUP_TOKEN must contain at least 32 characters");
}
const adminState = database.query<AdminSetupState, [string]>(`
  SELECT password_hash, setup_token_hash FROM users WHERE username = ?
`).get("admin");
if (
  ADMIN_SETUP_TOKEN === "" &&
  (adminState === null || adminState.password_hash === null && adminState.setup_token_hash === null)
) {
  throw new Error("NANIME_ADMIN_SETUP_TOKEN is required for initial setup");
}
const adminTokenHash = ADMIN_SETUP_TOKEN === ""
  ? null
  : createHash("sha256").update(ADMIN_SETUP_TOKEN).digest("hex");
database.query<void, [string, string | null, number]>(`
  INSERT INTO users (username, setup_token_hash, is_admin, created_at)
  VALUES (?, ?, 1, ?)
  ON CONFLICT(username) DO UPDATE SET is_admin = 1
`).run("admin", adminTokenHash, Date.now());
if (adminTokenHash !== null) {
  database.query<void, [string, string]>(`
    UPDATE users SET setup_token_hash = ?
    WHERE username = ? AND password_hash IS NULL AND setup_token_hash IS NULL
  `).run(adminTokenHash, "admin");
}
database.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
database.run("CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)");
database.run("CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at)");

const playbackColumns = database
  .query<TableColumn, []>("PRAGMA table_info(playback_progress)")
  .all();
const hasLegacyProgress = playbackColumns.length > 0 &&
  !playbackColumns.some((column) => column.name === "user_id");

const migratePlayback = database.transaction(() => {
  database.run("ALTER TABLE playback_progress RENAME TO playback_progress_legacy");
  database.run(`
    CREATE TABLE playback_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rel TEXT NOT NULL,
      position REAL NOT NULL,
      duration REAL NOT NULL,
      completed INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, rel)
    )
  `);
  database.run(`
    INSERT INTO playback_progress (user_id, rel, position, duration, completed, updated_at)
    SELECT users.id, legacy.rel, legacy.position, legacy.duration, legacy.completed, legacy.updated_at
    FROM playback_progress_legacy AS legacy
    CROSS JOIN users
    WHERE users.username = 'admin'
  `);
  database.run("DROP TABLE playback_progress_legacy");
});

if (hasLegacyProgress) {
  migratePlayback();
}
database.run(`
  CREATE TABLE IF NOT EXISTS playback_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rel TEXT NOT NULL,
    position REAL NOT NULL,
    duration REAL NOT NULL,
    completed INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, rel)
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS media_metadata (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);
