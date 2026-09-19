import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { jobsDbFile } from '../paths.js'

// Kept apart from polyglots.db on purpose. That one holds the translation
// memory, built up from TMX imports over months. This one holds run state,
// which is disposable: deleting it costs a re-review and nothing else. Sharing
// a file would mean a schema change here could corrupt the memory, and would
// mean a development build migrating a file a stable build is mid-run on.
const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS run (
  id          INTEGER PRIMARY KEY,
  file        TEXT NOT NULL,
  project     TEXT,
  command     TEXT NOT NULL,
  locale      TEXT NOT NULL,
  nplurals    INTEGER NOT NULL,
  batch_size  INTEGER NOT NULL,
  engine      TEXT NOT NULL,
  state       TEXT NOT NULL,
  -- The process that owns this run. A hard kill leaves a row still claiming to
  -- be running, and without a pid there is no way to tell that from a run that
  -- is genuinely in flight.
  pid         INTEGER,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  entries     INTEGER,
  flagged     INTEGER,
  repaired    INTEGER,
  unreviewed  INTEGER,
  approvable  INTEGER,
  by_category TEXT
);

CREATE TABLE IF NOT EXISTS entry (
  run_id INTEGER NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  key    TEXT NOT NULL,
  ord    INTEGER NOT NULL,
  PRIMARY KEY (run_id, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS audit_verdict (
  src_hash    TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  locale      TEXT NOT NULL,
  engine      TEXT NOT NULL,
  problem     INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  categories  TEXT NOT NULL,
  fix         TEXT,
  at          INTEGER NOT NULL,
  PRIMARY KEY (src_hash, config_hash, locale, engine)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS draft (
  src_hash    TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  locale      TEXT NOT NULL,
  engine      TEXT NOT NULL,
  text        TEXT NOT NULL,
  at          INTEGER NOT NULL,
  PRIMARY KEY (src_hash, config_hash, locale, engine)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS draft_verdict (
  src_hash    TEXT NOT NULL,
  draft_hash  TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  locale      TEXT NOT NULL,
  engine      TEXT NOT NULL,
  text        TEXT NOT NULL,
  fuzzy       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  at          INTEGER NOT NULL,
  PRIMARY KEY (src_hash, draft_hash, config_hash, locale, engine)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS run_started ON run (started_at);
`

// CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
// database written before a column was added needs the column adding by hand.
// Additive only: no data moves and nothing is dropped.
function addMissingColumns(db: Database.Database): void {
  const has = (table: string, column: string): boolean =>
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).some((c) => c.name === column)
  if (!has('run', 'pid')) db.exec('ALTER TABLE run ADD COLUMN pid INTEGER')
}

export function openJobsDb(path: string = jobsDbFile()): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(MIGRATIONS)
  addMissingColumns(db)
  return db
}
