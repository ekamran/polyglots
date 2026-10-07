import { mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser'
import { UsageError } from '../cli/args.js'
import { loadPo, PoFile, unitKey } from '../po/po-file.js'

export interface SplitOptions {
  file: string
  // Entries per part, counted over everything the catalogue holds, translated
  // or not. The last part is whatever is left over.
  size: number
  // Write into a folder that already holds files. Nothing is deleted even
  // then; see `leftBehind`.
  force?: boolean
}

export interface SplitPart {
  file: string
  entries: number
}

export interface SplitSummary {
  file: string
  dir: string
  entries: number
  size: number
  parts: SplitPart[]
  /**
   * `.po` files that were already in the folder and are not part of this split.
   *
   * A finer split leaves higher-numbered parts behind, and they look exactly
   * like work waiting to be uploaded. Nothing is deleted, because a part may
   * have been reviewed and edited in place; naming them is what stops one
   * being submitted as though it belonged to this run.
   */
  leftBehind: string[]
}

export function partCount(entries: number, size: number): number {
  return Math.ceil(entries / size)
}

/**
 * The name of one part.
 *
 * The index is padded to the width the part count needs, and to at least two
 * digits. Unpadded, a name sort reads 1, 10, 100, 11, which is the order the
 * file picker would list them in and the order a person would read them in.
 */
export function partName(base: string, index: number, parts: number): string {
  const width = Math.max(2, String(parts).length)
  return `${base}-${String(index).padStart(width, '0')}.po`
}

// Source order, so part 01 is the top of the file and a person can reason about
// where they are. `order` is the map built from the original text, and an entry
// the map does not know sorts last rather than throwing off the ones it does.
function orderedEntries(po: PoFile): GetTextTranslation[] {
  const out: GetTextTranslation[] = []
  for (const ctx of Object.keys(po.raw.translations)) {
    for (const msgid of Object.keys(po.raw.translations[ctx] ?? {})) {
      if (ctx === '' && msgid === '') continue
      const entry = po.raw.translations[ctx]?.[msgid]
      if (entry) out.push(entry)
    }
  }
  const rank = (e: GetTextTranslation): number =>
    po.order.get(unitKey(e.msgid, e.msgctxt)) ?? Number.MAX_SAFE_INTEGER
  return out.sort((a, b) => rank(a) - rank(b))
}

// gettext-parser keeps retired entries in a bucket of their own and re-emits
// them on compile, so a part built from a copy of the source carries all of
// them. They go in the first part alone: dropping them would make the parts an
// incomplete account of the file, and repeating them would multiply dead
// strings by the number of parts.
function rawPart(po: PoFile, slice: GetTextTranslation[], first: boolean): GetTextTranslations {
  const header = po.raw.translations['']?.['']
  const translations: GetTextTranslations['translations'] = header ? { '': { '': header } } : {}
  for (const entry of slice) {
    const ctx = entry.msgctxt ?? ''
    translations[ctx] = { ...translations[ctx], [entry.msgid]: entry }
  }
  const source = po.raw as GetTextTranslations & { obsolete?: unknown }
  return {
    charset: po.raw.charset,
    headers: { ...po.raw.headers },
    translations,
    ...(first && source.obsolete ? { obsolete: source.obsolete } : {}),
  } as GetTextTranslations
}

/**
 * Cuts a catalogue into parts small enough to run one at a time.
 *
 * The point is not that a big file cannot be processed. It is that a review is
 * only useful once it is finished: with parts, each one can be checked and
 * submitted while the rest are still waiting, instead of everything landing at
 * the end. Nothing is cached per file, so splitting costs no repeated work.
 */
export async function splitPo(opts: SplitOptions): Promise<SplitSummary> {
  if (!Number.isInteger(opts.size) || opts.size < 1) {
    throw new UsageError(`--size must be a positive integer, got ${opts.size}`)
  }

  const po = await loadPo(opts.file)
  const entries = orderedEntries(po)
  if (entries.length === 0) {
    throw new UsageError(`${opts.file} has no entries to split`)
  }

  const base = basename(opts.file, extname(opts.file))
  const dir = join(dirname(opts.file), `${base}-split`)

  const existing = await readdir(dir).catch(() => undefined)
  if (existing !== undefined && existing.length > 0 && !opts.force) {
    throw new UsageError(
      `${dir} already has ${existing.length} file(s) in it. Delete it, or pass --force to write over the parts.`,
    )
  }
  await mkdir(dir, { recursive: true })

  const parts = partCount(entries.length, opts.size)
  const written: SplitPart[] = []
  for (let index = 0; index < parts; index++) {
    const slice = entries.slice(index * opts.size, (index + 1) * opts.size)
    const name = partName(base, index + 1, parts)
    const path = join(dir, name)
    // The source's own order map is handed over so each part sorts the way the
    // file did, and the header is written unstamped: nothing here was revised.
    const part = new PoFile(path, rawPart(po, slice, index === 0), po.order)
    await part.save(path, new Date(), false)
    written.push({ file: path, entries: slice.length })
  }

  const ours = new Set(written.map((p) => basename(p.file)))
  const leftBehind = (existing ?? []).filter((name) => name.endsWith('.po') && !ours.has(name)).sort()

  return { file: opts.file, dir, entries: entries.length, size: opts.size, parts: written, leftBehind }
}
