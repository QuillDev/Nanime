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
if (!userColumns.some((column) => column.name === "preferred_audio_language")) {
  database.run("ALTER TABLE users ADD COLUMN preferred_audio_language TEXT");
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
      dismissed_at INTEGER,
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
    dismissed_at INTEGER,
    PRIMARY KEY (user_id, rel)
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS playback_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_user_id INTEGER,
    actor_username TEXT NOT NULL,
    rel TEXT NOT NULL,
    action TEXT NOT NULL,
    origin TEXT NOT NULL,
    previous_state TEXT,
    next_state TEXT,
    anilist_media_id INTEGER,
    episode INTEGER,
    total_episodes INTEGER,
    session_seconds REAL,
    reverts_event_id INTEGER,
    created_at INTEGER NOT NULL
  )
`);
const playbackAuditColumns = database
  .query<TableColumn, []>("PRAGMA table_info(playback_audit_log)")
  .all();
if (!playbackAuditColumns.some((column) => column.name === "session_seconds")) {
  database.run("ALTER TABLE playback_audit_log ADD COLUMN session_seconds REAL");
}
database.run(`
  CREATE INDEX IF NOT EXISTS playback_audit_user_created
  ON playback_audit_log(user_id, created_at DESC, id DESC)
`);
database.run(`
  CREATE INDEX IF NOT EXISTS playback_audit_user_rel_created
  ON playback_audit_log(user_id, rel, created_at DESC, id DESC)
`);
database.run(`
  CREATE TRIGGER IF NOT EXISTS playback_audit_log_no_update
  BEFORE UPDATE ON playback_audit_log
  BEGIN
    SELECT RAISE(ABORT, 'playback audit entries are immutable');
  END
`);
database.run(`
  CREATE TRIGGER IF NOT EXISTS playback_audit_log_no_delete
  BEFORE DELETE ON playback_audit_log
  BEGIN
    SELECT RAISE(ABORT, 'playback audit entries are immutable');
  END
`);
database.run(`
  CREATE TABLE IF NOT EXISTS library_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER NOT NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL,
    subject TEXT NOT NULL,
    previous_state TEXT,
    next_state TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE INDEX IF NOT EXISTS library_activity_created
  ON library_activity_log(created_at DESC, id DESC)
`);
database.run(`
  CREATE TRIGGER IF NOT EXISTS library_activity_log_no_update
  BEFORE UPDATE ON library_activity_log
  BEGIN
    SELECT RAISE(ABORT, 'library activity entries are immutable');
  END
`);
database.run(`
  CREATE TRIGGER IF NOT EXISTS library_activity_log_no_delete
  BEFORE DELETE ON library_activity_log
  BEGIN
    SELECT RAISE(ABORT, 'library activity entries are immutable');
  END
`);
const currentPlaybackColumns = database
  .query<TableColumn, []>("PRAGMA table_info(playback_progress)")
  .all();
if (!currentPlaybackColumns.some((column) => column.name === "dismissed_at")) {
  database.run("ALTER TABLE playback_progress ADD COLUMN dismissed_at INTEGER");
}
database.run(`
  CREATE TABLE IF NOT EXISTS media_metadata (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS media_library (
    rel TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    size INTEGER NOT NULL,
    direct INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS media_library_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_scanned_at INTEGER NOT NULL,
    entry_count INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS transcode_jobs (
    id TEXT PRIMARY KEY,
    source_rel TEXT NOT NULL,
    preset TEXT NOT NULL,
    output_rel TEXT NOT NULL,
    status TEXT NOT NULL,
    input_size INTEGER NOT NULL,
    output_size INTEGER,
    progress REAL NOT NULL DEFAULT 0,
    speed REAL NOT NULL DEFAULT 0,
    started_at INTEGER,
    error TEXT,
    original_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS offline_media_artifacts (
    id TEXT PRIMARY KEY,
    source_rel TEXT NOT NULL,
    source_size INTEGER NOT NULL,
    source_modified_at REAL NOT NULL,
    audio_index INTEGER NOT NULL,
    direct INTEGER NOT NULL,
    output_name TEXT,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    speed REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    size_bytes INTEGER,
    mime_type TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(source_rel, source_size, source_modified_at, audio_index)
  )
`);
database.run(`
  CREATE INDEX IF NOT EXISTS offline_media_artifacts_status_created
  ON offline_media_artifacts(status, created_at)
`);
database.run(`
  UPDATE offline_media_artifacts
  SET status = 'queued', progress = 0, speed = 0, error = NULL
  WHERE status = 'preparing'
`);
database.run(`
  CREATE TABLE IF NOT EXISTS media_scans (
    source_rel TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    duration REAL,
    format_name TEXT,
    video_codec TEXT,
    width INTEGER,
    height INTEGER,
    audio_bytes INTEGER NOT NULL DEFAULT 0,
    subtitle_bytes INTEGER NOT NULL DEFAULT 0,
    scanned_at INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS media_scan_tracks (
    source_rel TEXT NOT NULL REFERENCES media_scans(source_rel) ON DELETE CASCADE,
    stream_index INTEGER NOT NULL,
    kind TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    PRIMARY KEY (source_rel, stream_index, kind)
  )
`);
database.run("CREATE INDEX IF NOT EXISTS media_scans_status_created ON media_scans(status, created_at)");
const transcodeColumns = database.query<TableColumn, []>("PRAGMA table_info(transcode_jobs)").all();
if (!transcodeColumns.some((column) => column.name === "progress")) {
  database.run("ALTER TABLE transcode_jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0");
}
if (!transcodeColumns.some((column) => column.name === "speed")) {
  database.run("ALTER TABLE transcode_jobs ADD COLUMN speed REAL NOT NULL DEFAULT 0");
}
if (!transcodeColumns.some((column) => column.name === "started_at")) {
  database.run("ALTER TABLE transcode_jobs ADD COLUMN started_at INTEGER");
}
database.run(`
  CREATE TABLE IF NOT EXISTS anilist_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    anilist_id INTEGER NOT NULL UNIQUE,
    anilist_name TEXT NOT NULL,
    avatar_url TEXT,
    encrypted_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);
database.run(`
  CREATE TABLE IF NOT EXISTS anilist_oauth_states (
    state_hash TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
database.run("CREATE INDEX IF NOT EXISTS anilist_oauth_states_expires_at ON anilist_oauth_states(expires_at)");
database.run(`
  CREATE TABLE IF NOT EXISTS anilist_sync_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL,
    progress INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, media_id)
  )
`);

database.run(`
  CREATE TABLE IF NOT EXISTS watch_together (
    id TEXT PRIMARY KEY,
    host_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    host_token TEXT NOT NULL,
    rel TEXT NOT NULL,
    position REAL NOT NULL,
    paused INTEGER NOT NULL,
    rate REAL NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

const partyColumns = database.query<TableColumn, []>("PRAGMA table_info(watch_together)").all();
if (!partyColumns.some((column) => column.name === "host_member_id")) {
  database.transaction(() => {
    database.run(`CREATE TABLE watch_together_membership_migration (
      id TEXT PRIMARY KEY,
      host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_token TEXT NOT NULL, rel TEXT NOT NULL, position REAL NOT NULL,
      paused INTEGER NOT NULL, rate REAL NOT NULL, updated_at INTEGER NOT NULL,
      host_member_id TEXT, generation INTEGER NOT NULL DEFAULT 1,
      active_at INTEGER NOT NULL
    )`);
    database.run(`INSERT INTO watch_together_membership_migration
      (id, host_id, host_token, rel, position, paused, rate, updated_at, active_at)
      SELECT id, host_id, host_token, rel, position, paused, rate, updated_at, updated_at FROM watch_together`);
    database.run("DROP TABLE watch_together");
    database.run("ALTER TABLE watch_together_membership_migration RENAME TO watch_together");
  })();
}
database.run(`CREATE TABLE IF NOT EXISTS watch_together_members (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES watch_together(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  incarnation INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE (room_id, token_hash)
)`);
database.run("CREATE INDEX IF NOT EXISTS watch_members_room ON watch_together_members(room_id, seen_at)");
