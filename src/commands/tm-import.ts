import type Database from 'better-sqlite3'
import { openDb, upsertTm } from '../storage/index.js'
import { loadTmx, normalizeLocale } from '../tmx/parse.js'
import type { Locale } from '../types.js'

export interface TmImportProgress {
  file: string
  entries: number
  upserted: number
}

export interface TmImportOptions {
  locale: Locale
  project?: string
  db?: Database.Database
  onProgress?: (e: TmImportProgress) => void
}

export interface TmImportResult {
  files: number
  entries: number
  upserted: number
}

export async function importTmx(files: string[], opts: TmImportOptions): Promise<TmImportResult> {
  const locale = normalizeLocale(opts.locale)
  if (!locale) throw new Error('Locale must not be empty')
  const result: TmImportResult = { files: 0, entries: 0, upserted: 0 }
  if (files.length === 0) return result

  const ownsDb = opts.db === undefined
  const db = opts.db ?? openDb()
  try {
    for (const file of files) {
      const entries = await loadFile(file, locale, opts.project)
      const upserted = upsertTm(db, entries)
      result.files += 1
      result.entries += entries.length
      result.upserted += upserted
      opts.onProgress?.({ file, entries: entries.length, upserted })
    }
  } finally {
    if (ownsDb) db.close()
  }
  return result
}

async function loadFile(file: string, targetLocale: Locale, project?: string) {
  try {
    return await loadTmx(file, { targetLocale, project })
  } catch (err) {
    if (isFsErrorFor(err, file)) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to import ${file}: ${message}`, { cause: err })
  }
}

// fs errors already carry the offending path in their message; wrapping would print it twice.
function isFsErrorFor(err: unknown, file: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).path === file
}
