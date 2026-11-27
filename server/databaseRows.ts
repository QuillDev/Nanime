import type { Generated } from "kysely";
import { z } from "zod";

/**
 * One Zod schema per table row as SQLite returns it. Every query result is
 * parsed through one of these (or a pick of one), and the Kysely table types
 * below are inferred from them, so the SQL builder and the parser agree.
 */
const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();

export const TableColumnRowSchema = z.object({ name: z.string() });
export type TableColumnRow = z.infer<typeof TableColumnRowSchema>;
export const CountRowSchema = z.object({ count: z.number() });
export type CountRow = z.infer<typeof CountRowSchema>;

export const UserRowSchema = z.object({
  id: z.number(),
  username: z.string(),
  password_hash: nullableText,
  setup_token_hash: nullableText,
  is_admin: z.number(),
  created_at: z.number(),
  preferred_audio_language: nullableText,
});
export type UserRow = z.infer<typeof UserRowSchema>;
export const SessionRowSchema = z.object({
  token_hash: z.string(),
  user_id: z.number(),
  expires_at: z.number(),
  created_at: z.number(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;
export const DeviceLoginRowSchema = z.object({
  device_hash: z.string(),
  user_code: z.string(),
  device: z.string(),
  user_id: nullableNumber,
  created_at: z.number(),
  expires_at: z.number(),
});
export type DeviceLoginRow = z.infer<typeof DeviceLoginRowSchema>;
export const AgentKeyRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  key_hash: z.string(),
  user_id: z.number(),
  created_at: z.number(),
  last_used_at: nullableNumber,
});
export type AgentKeyRow = z.infer<typeof AgentKeyRowSchema>;
export const PlaybackProgressRowSchema = z.object({
  user_id: z.number(),
  rel: z.string(),
  position: z.number(),
  duration: z.number(),
  completed: z.number(),
  updated_at: z.number(),
  dismissed_at: nullableNumber,
});
export type PlaybackProgressRow = z.infer<typeof PlaybackProgressRowSchema>;
export const PlaybackAuditRowSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  actor_user_id: nullableNumber,
  actor_username: z.string(),
  rel: z.string(),
  action: z.enum(["completed", "playback-started", "playback-stopped", "restored", "snapshot-imported", "watched", "unwatched"]),
  origin: z.enum(["episode-menu", "history", "home", "media-library", "migration", "player", "season-menu", "series-menu"]),
  previous_state: nullableText,
  next_state: nullableText,
  anilist_media_id: nullableNumber,
  episode: nullableNumber,
  total_episodes: nullableNumber,
  session_seconds: nullableNumber,
  reverts_event_id: nullableNumber,
  created_at: z.number(),
});
export type PlaybackAuditRow = z.infer<typeof PlaybackAuditRowSchema>;
export const LibraryActivityRowSchema = z.object({
  id: z.number(),
  actor_user_id: z.number(),
  actor_username: z.string(),
  action: z.enum(["files-moved", "files-renamed", "files-reverted", "files-trashed", "folder-created", "mapping-updated", "media-uploaded"]),
  subject: z.string(),
  previous_state: nullableText,
  next_state: z.string(),
  created_at: z.number(),
});
export type LibraryActivityRow = z.infer<typeof LibraryActivityRowSchema>;
export const MediaMetadataRowSchema = z.object({ key: z.string(), payload: z.string(), updated_at: z.number() });
export type MediaMetadataRow = z.infer<typeof MediaMetadataRowSchema>;
export const MetadataCacheRowSchema = z.object({ ref: z.string(), payload: z.string(), updated_at: z.number() });
export type MetadataCacheRow = z.infer<typeof MetadataCacheRowSchema>;
export const EpisodeMetadataCacheRowSchema = z.object({
  anilist_id: z.number(),
  providers: z.string(),
  payload: z.string(),
  updated_at: z.number(),
});
export type EpisodeMetadataCacheRow = z.infer<typeof EpisodeMetadataCacheRowSchema>;
export const MetadataFilesMigrationRowSchema = z.object({ id: z.number(), migrated_at: z.number() });
export type MetadataFilesMigrationRow = z.infer<typeof MetadataFilesMigrationRowSchema>;
export const MediaLibraryRowSchema = z.object({
  rel: z.string(),
  name: z.string(),
  folder: z.string(),
  size: z.number(),
  direct: z.number(),
  added_at: z.number(),
});
export type MediaLibraryRow = z.infer<typeof MediaLibraryRowSchema>;
export const MediaLibraryStateRowSchema = z.object({ id: z.number(), last_scanned_at: z.number(), entry_count: z.number() });
export type MediaLibraryStateRow = z.infer<typeof MediaLibraryStateRowSchema>;
export const TranscodeJobRowSchema = z.object({
  id: z.string(),
  source_rel: z.string(),
  preset: z.enum(["compatibility", "space-saver"]),
  output_rel: z.string(),
  status: z.enum(["cancelled", "complete", "failed", "processing", "queued"]),
  input_size: z.number(),
  output_size: nullableNumber,
  progress: z.number(),
  speed: z.number(),
  started_at: nullableNumber,
  error: nullableText,
  original_deleted: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type TranscodeJobRow = z.infer<typeof TranscodeJobRowSchema>;
export const OfflineMediaArtifactRowSchema = z.object({
  id: z.string(),
  source_rel: z.string(),
  source_size: z.number(),
  source_modified_at: z.number(),
  audio_index: z.number(),
  direct: z.number(),
  output_name: nullableText,
  status: z.enum(["failed", "preparing", "queued", "ready"]),
  progress: z.number(),
  speed: z.number(),
  duration: z.number(),
  size_bytes: nullableNumber,
  mime_type: z.string(),
  error: nullableText,
  created_at: z.number(),
  updated_at: z.number(),
});
export type OfflineMediaArtifactRow = z.infer<typeof OfflineMediaArtifactRowSchema>;
export const MediaScanRowSchema = z.object({
  source_rel: z.string(),
  status: z.enum(["queued", "scanning", "complete", "failed"]),
  file_size: z.number(),
  modified_at: z.number(),
  duration: nullableNumber,
  format_name: nullableText,
  video_codec: nullableText,
  width: nullableNumber,
  height: nullableNumber,
  audio_bytes: z.number(),
  subtitle_bytes: z.number(),
  scanned_at: nullableNumber,
  error: nullableText,
  created_at: z.number(),
  updated_at: z.number(),
});
export type MediaScanRow = z.infer<typeof MediaScanRowSchema>;
export const MediaScanTrackRowSchema = z.object({
  source_rel: z.string(),
  stream_index: z.number(),
  kind: z.enum(["audio", "subtitle"]),
  size_bytes: z.number(),
});
export type MediaScanTrackRow = z.infer<typeof MediaScanTrackRowSchema>;
export const AniListAccountRowSchema = z.object({
  user_id: z.number(),
  anilist_id: z.number(),
  anilist_name: z.string(),
  avatar_url: nullableText,
  encrypted_token: z.string(),
  token_expires_at: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type AniListAccountRow = z.infer<typeof AniListAccountRowSchema>;
export const AniListOAuthStateRowSchema = z.object({
  state_hash: z.string(),
  user_id: nullableNumber,
  expires_at: z.number(),
  created_at: z.number(),
});
export type AniListOAuthStateRow = z.infer<typeof AniListOAuthStateRowSchema>;
export const AniListSyncProgressRowSchema = z.object({
  user_id: z.number(),
  media_id: z.number(),
  progress: z.number(),
  status: z.string(),
  updated_at: z.number(),
});
export type AniListSyncProgressRow = z.infer<typeof AniListSyncProgressRowSchema>;
export const WatchTogetherRowSchema = z.object({
  id: z.string(),
  host_id: z.number(),
  host_token: z.string(),
  rel: z.string(),
  position: z.number(),
  paused: z.number(),
  rate: z.number(),
  updated_at: z.number(),
  host_member_id: nullableText,
  generation: z.number(),
  active_at: z.number(),
});
export type WatchTogetherRow = z.infer<typeof WatchTogetherRowSchema>;
export const WatchTogetherMemberRowSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  user_id: z.number(),
  token_hash: z.string(),
  connection_id: z.string(),
  incarnation: z.number(),
  joined_at: z.number(),
  seen_at: z.number(),
  left_at: nullableNumber,
});
export type WatchTogetherMemberRow = z.infer<typeof WatchTogetherMemberRowSchema>;
export const LibraryFileOperationRowSchema = z.object({
  id: z.string(),
  kind: z.enum(["create-folder", "move", "rename", "revert", "trash"]),
  status: z.enum(["committed", "failed", "pending", "recovery-required", "rolled-back"]),
  actor_user_id: z.number(),
  actor_username: z.string(),
  steps: z.string(),
  reverts_operation_id: nullableText,
  reverted_by_operation_id: nullableText,
  error: nullableText,
  progress: nullableText,
  created_at: z.number(),
  updated_at: z.number(),
});
export type LibraryFileOperationRow = z.infer<typeof LibraryFileOperationRowSchema>;
export const MediaPathHistoryRowSchema = z.object({
  id: z.number(),
  operation_id: z.string(),
  old_rel: z.string(),
  new_rel: z.string(),
  created_at: z.number(),
  audit_watermark: nullableNumber,
});
export type MediaPathHistoryRow = z.infer<typeof MediaPathHistoryRowSchema>;
export const LibraryTorrentAdditionRowSchema = z.object({
  tag: z.string(),
  root: z.string(),
  scope: z.string(),
  owned: z.string(),
});
export type LibraryTorrentAdditionRow = z.infer<typeof LibraryTorrentAdditionRowSchema>;
export const DownloadJobRowSchema = z.object({
  id: z.string(),
  show_folder: z.string(),
  file_name: z.string(),
  url: z.string(),
  headers: z.string(),
  format: z.enum(["file", "hls"]),
  state: z.enum(["queued", "downloading", "paused", "failed"]),
  received: z.number(),
  size: z.number(),
  error: nullableText,
  added_at: z.number(),
  source_id: nullableText,
  episode_url: nullableText,
});
export type DownloadJobRow = z.infer<typeof DownloadJobRowSchema>;
export const SourceRepoRowSchema = z.object({ url: z.string(), added_at: z.number() });
export type SourceRepoRow = z.infer<typeof SourceRepoRowSchema>;
export const SourceRowSchema = z.object({
  id: z.string(),
  repo_url: z.string(),
  name: z.string(),
  lang: z.string(),
  version: z.string(),
  icon_url: nullableText,
  nsfw: z.number(),
  info: z.string(),
  code: z.string(),
  installed_at: z.number(),
});
export type SourceRow = z.infer<typeof SourceRowSchema>;
export const SourceSettingRowSchema = z.object({ source_id: z.string(), key: z.string(), value: z.string() });
export type SourceSettingRow = z.infer<typeof SourceSettingRowSchema>;

/** A row type whose `Defaults` columns SQLite fills in when an insert leaves them out. */
type Table<Columns, Defaults extends keyof Columns = never> = {
  [Column in keyof Columns]: Column extends Defaults ? Generated<Columns[Column]> : Columns[Column];
};

/** Kysely's view of the database, inferred from the row schemas above. */
export interface Database {
  readonly users: Table<UserRow, "id" | "is_admin">;
  readonly sessions: SessionRow;
  readonly device_logins: DeviceLoginRow;
  readonly agent_keys: Table<AgentKeyRow, "id">;
  readonly playback_progress: PlaybackProgressRow;
  readonly playback_audit_log: Table<PlaybackAuditRow, "id">;
  readonly library_activity_log: Table<LibraryActivityRow, "id">;
  readonly media_metadata: MediaMetadataRow;
  readonly metadata_cache: MetadataCacheRow;
  readonly episode_metadata_cache: EpisodeMetadataCacheRow;
  readonly metadata_files_migration: MetadataFilesMigrationRow;
  readonly media_library: Table<MediaLibraryRow, "added_at">;
  readonly media_library_state: MediaLibraryStateRow;
  readonly transcode_jobs: Table<TranscodeJobRow, "progress" | "speed" | "original_deleted">;
  readonly offline_media_artifacts: Table<OfflineMediaArtifactRow, "progress" | "speed" | "duration">;
  readonly media_scans: Table<MediaScanRow, "audio_bytes" | "subtitle_bytes">;
  readonly media_scan_tracks: MediaScanTrackRow;
  readonly anilist_accounts: AniListAccountRow;
  readonly anilist_oauth_states: AniListOAuthStateRow;
  readonly anilist_sync_progress: AniListSyncProgressRow;
  readonly watch_together: Table<WatchTogetherRow, "generation">;
  readonly watch_together_members: WatchTogetherMemberRow;
  readonly library_file_operations: LibraryFileOperationRow;
  readonly media_path_history: Table<MediaPathHistoryRow, "id">;
  readonly library_torrent_additions: LibraryTorrentAdditionRow;
  readonly download_jobs: Table<DownloadJobRow, "received" | "size">;
  readonly source_repos: SourceRepoRow;
  readonly sources: SourceRow;
  readonly source_settings: SourceSettingRow;
}
