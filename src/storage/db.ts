import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { dbFile } from '../paths.js'

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS tm (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  locale TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  project TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (source, locale, context)
);

CREATE VIRTUAL TABLE IF NOT EXISTS tm_fts USING fts5(
  source,
  content='tm',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS tm_ai AFTER INSERT ON tm BEGIN
  INSERT INTO tm_fts(rowid, source) VALUES (new.id, new.source);
END;

CREATE TRIGGER IF NOT EXISTS tm_ad AFTER DELETE ON tm BEGIN
  INSERT INTO tm_fts(tm_fts, rowid, source) VALUES ('delete', old.id, old.source);
END;

CREATE TRIGGER IF NOT EXISTS tm_au AFTER UPDATE OF source ON tm BEGIN
  INSERT INTO tm_fts(tm_fts, rowid, source) VALUES ('delete', old.id, old.source);
  INSERT INTO tm_fts(rowid, source) VALUES (new.id, new.source);
END;

CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY,
  locale TEXT NOT NULL,
  source_term TEXT NOT NULL,
  translation TEXT NOT NULL,
  part_of_speech TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS glossary_locale_term ON glossary (locale, source_term COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS consistency_cache (
  source_text TEXT NOT NULL,
  locale TEXT NOT NULL,
  scope TEXT NOT NULL,
  results_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source_text, locale, scope)
);
`

// Rows cached before `scope` existed hold unfiltered all-project results under what is now
// the core-scoped key. The cache is disposable, so drop it rather than migrate the rows.
function dropPreScopeCache(db: Database.Database): void {
  const columns = db.pragma('table_info(consistency_cache)') as Array<{ name: string }>
  if (columns.length > 0 && !columns.some(c => c.name === 'scope')) {
    db.exec('DROP TABLE consistency_cache;')
  }
}

export function openDb(path: string = dbFile()): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  dropPreScopeCache(db)
  db.exec(MIGRATIONS)
  return db
}
