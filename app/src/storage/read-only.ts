import Database from 'better-sqlite3'

/**
 * Runs `read` against a SQLite file opened read-only, and gives `fallback`
 * when the file is missing, cannot be opened, or the read throws.
 *
 * For the places that only look: the setup status, the Locale Rules trial,
 * the hint about earlier Turkish work. Not openDb() or openJobsDb(): those
 * set WAL and run migrations, which is a write, and to polyglots.db a write
 * from a screen that only looks is a risk to the one file polyglots cannot
 * regenerate, maybe beside a review that is writing to it.
 *
 * A read-only handle on a WAL database still creates the side files when
 * they are missing: a 0-byte -wal and a 32 KB -shm, which the next writer's
 * close removes. immutable=1 would avoid them, but promises SQLite the file
 * cannot change, which is false while a review is writing and can serve a
 * torn read. fileMustExist keeps a missing database missing.
 */
export function readOnly<T>(path: string, read: (db: Database.Database) => T, fallback: T): T {
  let db: Database.Database | undefined
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    return read(db)
  } catch {
    return fallback
  } finally {
    db?.close()
  }
}
