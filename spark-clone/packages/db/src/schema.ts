/**
 * Migrations run in order; `PRAGMA user_version` tracks the last applied index.
 * SQL is embedded (not .sql files) so the module needs no bundler plumbing in
 * the utility process or in tests.
 */
export const MIGRATIONS: string[] = [
  `
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'imap',
  imap_json TEXT NOT NULL,
  smtp_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'other',
  delimiter TEXT,
  uidvalidity INTEGER,
  highestmodseq TEXT,
  last_seen_uid INTEGER NOT NULL DEFAULT 0,
  UNIQUE(account_id, path)
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  -- placement is the Spark state machine: inbox | done | set_aside | snoozed
  placement TEXT NOT NULL DEFAULT 'inbox',
  pinned INTEGER NOT NULL DEFAULT 0,
  last_message_date INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  participants_json TEXT NOT NULL DEFAULT '[]',
  has_attachments INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX threads_account_date ON threads(account_id, last_message_date DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  message_id_hdr TEXT,
  in_reply_to TEXT,
  refs_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  from_json TEXT,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  date INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  seen INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  draft INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  UNIQUE(folder_id, uid)
);
CREATE INDEX messages_thread ON messages(thread_id);
CREATE INDEX messages_msgid ON messages(message_id_hdr);
CREATE INDEX messages_account_date ON messages(account_id, date DESC);

CREATE TABLE message_bodies (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  html TEXT,
  text TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  cid TEXT,
  part TEXT,
  local_path TEXT
);
CREATE INDEX attachments_message ON attachments(message_id);

-- Standalone FTS5 (not external-content: the indexed text spans two source
-- tables, which external-content cannot express). rowid mirrors messages.rowid.
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, from_text, body,
  tokenize='porter unicode61'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, from_text, body)
  VALUES (new.rowid, new.subject, coalesce(new.from_json, ''), '');
END;

CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER message_bodies_fts_insert AFTER INSERT ON message_bodies BEGIN
  UPDATE messages_fts
    SET body = coalesce(new.text, '')
    WHERE rowid = (SELECT rowid FROM messages WHERE id = new.message_id);
END;

-- Durable UI -> sync command queue.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_status ON tasks(status, id);

-- Spark-layer tables (consumers arrive in Phase 3/4; schema fixed now so
-- migrations don't churn).
CREATE TABLE snoozes (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  wake_at INTEGER,             -- NULL = "Someday"
  alert INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE scheduled_sends (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  send_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | overdue
  raw_mime TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE reminders (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  remind_at INTEGER NOT NULL,
  created_from TEXT NOT NULL DEFAULT 'composer',
  created_at INTEGER NOT NULL
);
CREATE TABLE set_aside (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE sender_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,            -- address or domain
  kind TEXT NOT NULL,           -- 'address' | 'domain'
  category TEXT NOT NULL,       -- 'personal' | 'notifications' | 'newsletters'
  source TEXT NOT NULL,         -- 'user' | 'heuristic'  (user always wins)
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, key, kind)
);
CREATE TABLE sender_reputation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown', -- unknown | pending | accepted | blocked
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, key, kind)
);
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE TABLE signatures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`,
  `
ALTER TABLE threads ADD COLUMN category TEXT NOT NULL DEFAULT 'personal';
CREATE INDEX threads_category ON threads(category);
`,
  `
ALTER TABLE accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password';
`,
  `
CREATE TABLE priority_senders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, email)
);
`,
  `
-- Two JS backfills run in migrate() when crossing this version:
-- 1. participants_json now orders correspondents newest-first.
-- 2. Stale heuristic bulk-category rules for known correspondents are dropped
--    (team aliases stamp List-Id on human mail and stuck colleagues in Newsletters).
SELECT 1;
`,
  `
-- Thread snippets now preview the latest other-party message (pairing with
-- participants[0]) instead of the newest message overall; migrate() recomputes.
SELECT 1;
`,
  `
-- Calendar (Notion-Calendar-style). Local events are the source of truth;
-- Google rows (Phase 2) reconcile in by (calendar_id, remote_id). Notion
-- due-dates are derived in the renderer and never stored here.
CREATE TABLE calendars (
  id TEXT PRIMARY KEY,
  account_id TEXT,                       -- NULL for the local calendar
  remote_id TEXT,                        -- provider calendar id (Google)
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2f63e7',
  timezone TEXT,
  source TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'google'
  visible INTEGER NOT NULL DEFAULT 1,
  sync_token TEXT,                       -- Google incremental sync cursor
  updated_at INTEGER NOT NULL
);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'google'
  remote_id TEXT,                        -- provider event id (nullable)
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_ms INTEGER NOT NULL,             -- UTC ms
  end_ms INTEGER NOT NULL,               -- UTC ms
  all_day INTEGER NOT NULL DEFAULT 0,
  color TEXT,                            -- per-event override (else calendar color)
  rrule TEXT,                            -- RFC-5545 recurrence (Phase 3)
  status TEXT NOT NULL DEFAULT 'confirmed',
  meeting_url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX events_range ON events(start_ms, end_ms);
CREATE UNIQUE INDEX events_remote ON events(calendar_id, remote_id) WHERE remote_id IS NOT NULL;
INSERT INTO calendars (id, name, color, source, visible, updated_at)
  VALUES ('local-default', 'My Calendar', '#2f63e7', 'local', 1, 0);
`,
  `
-- Calendar phase 1: event types (out-of-office) ride on stored events.
ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'default';
`,
  `
-- role-filtered joins (listThreads view EXISTS, reconcilePlacements) run on
-- every sync tick; give them an index.
CREATE INDEX folders_account_role ON folders(account_id, role);
`,
  `
-- Per-event free/busy (Google 'transparency'); NULL/'opaque' = shows as Busy.
ALTER TABLE events ADD COLUMN transparency TEXT;
`,
  `
-- listThreads filters on placement with no account filter, which the
-- (account_id, last_message_date) index cannot serve: the planner fell back to
-- a full table scan plus a temp b-tree sort on every threads-changed delta.
CREATE INDEX threads_placement_date ON threads(placement, last_message_date DESC);

-- has_draft and the thread's participating addresses were correlated
-- subqueries re-evaluated per returned row. Denormalize them next to the other
-- aggregates refreshThreadAggregates already maintains.
ALTER TABLE threads ADD COLUMN has_draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN from_emails_json TEXT NOT NULL DEFAULT '[]';

-- Threads whose messages all went away were never revisited, so they piled up
-- unreferenced and every list query scanned straight through them.
DELETE FROM threads WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = threads.id);
`,
  `
-- last_message_date moves when WE write: a draft or a sent reply re-dates the
-- thread. Home's "new since you were last here" needs the newest message that
-- came from someone else, plus who that was, so it can show the real sender
-- rather than the account owner's own draft.
ALTER TABLE threads ADD COLUMN last_inbound_date INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN last_inbound_from_json TEXT;
`,
  `
-- The thread's correspondents as {name, email}, most recent sender first.
-- from_emails_json came out of a DISTINCT aggregate with no ordering, so
-- "the priority person on this thread" resolved to an arbitrary one rather
-- than whoever last replied.
ALTER TABLE threads ADD COLUMN senders_json TEXT NOT NULL DEFAULT '[]';
`,
];

/** Crossing this version triggers the JS backfills in migrate() (idempotent). */
export const JS_BACKFILL_VERSION = 6;

/**
 * Crossing this version repopulates the denormalized thread columns. Must equal
 * MIGRATIONS.length (the user_version a fully migrated database settles at) —
 * set it higher and the backfill re-runs over every thread on every launch.
 */
export const THREAD_DENORM_VERSION = MIGRATIONS.length;
