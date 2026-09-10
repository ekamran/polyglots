import { randomBytes } from 'node:crypto'
import { chmod, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { po } from 'gettext-parser'
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser'
import type { AuditEntry, TranslationUnit } from '../types.js'

export type UnitMode = 'pending' | 'all'

export interface ApplyResult {
  key: string
  text: string[]
  fuzzy: boolean
  // Why the reviewer left it fuzzy. Written as a translator comment so the note
  // travels with the entry into PoEdit.
  reason?: string
}

const KEY_SEPARATOR = '\u0004'

export function unitKey(msgid: string, msgctxt?: string): string {
  return msgctxt ? msgctxt + KEY_SEPARATOR + msgid : msgid
}

function splitKey(key: string): { msgctxt: string; msgid: string } {
  const at = key.indexOf(KEY_SEPARATOR)
  return at === -1 ? { msgctxt: '', msgid: key } : { msgctxt: key.slice(0, at), msgid: key.slice(at + 1) }
}

function parseNplurals(pluralForms: string | undefined): number {
  const match = /nplurals\s*=\s*(\d+)/.exec(pluralForms ?? '')
  const n = match ? Number(match[1]) : NaN
  return Number.isInteger(n) && n > 0 ? n : 2
}

function flagList(entry: GetTextTranslation): string[] {
  return (entry.comments?.flag ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
}

function isFuzzy(entry: GetTextTranslation): boolean {
  return flagList(entry).includes('fuzzy')
}

function isUntranslated(entry: GetTextTranslation): boolean {
  return entry.msgstr.every((s) => s === '')
}

function splitLines(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function toUnit(entry: GetTextTranslation): TranslationUnit {
  const unit: TranslationUnit = {
    key: unitKey(entry.msgid, entry.msgctxt),
    msgid: entry.msgid,
    comments: [...splitLines(entry.comments?.translator), ...splitLines(entry.comments?.extracted)],
    references: (entry.comments?.reference ?? '').split(/\s+/).filter(Boolean),
  }
  if (entry.msgctxt) unit.msgctxt = entry.msgctxt
  if (entry.msgid_plural !== undefined) unit.msgidPlural = entry.msgid_plural
  return unit
}

function revisionDate(now: Date): string {
  const iso = now.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}+0000`
}

function unescapePo(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c))
}

const STRING_FIELD = /^(msgctxt|msgid|msgid_plural|msgstr(?:\[\d+\])?)\s+"(.*)"$/

// gettext-parser keys entries by object, which hoists integer-like msgids and
// groups by msgctxt; the file's own order is recovered here so a save does not
// reshuffle entries.
export function sourceOrder(text: string): Map<string, number> {
  const order = new Map<string, number>()
  let msgctxt = ''
  let field: 'msgctxt' | 'msgid' | null = null
  let buffer = ''

  const flush = () => {
    if (field === 'msgctxt') msgctxt = buffer
    if (field === 'msgid') {
      const key = unitKey(buffer, msgctxt)
      if (!order.has(key)) order.set(key, order.size)
      msgctxt = ''
    }
    field = null
    buffer = ''
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '').replace(/^#~\s*/, '').trim()
    const match = STRING_FIELD.exec(line)
    if (match) {
      flush()
      if (match[1] === 'msgctxt' || match[1] === 'msgid') {
        field = match[1]
        buffer = unescapePo(match[2])
      }
      continue
    }
    if (field && line.length >= 2 && line.startsWith('"') && line.endsWith('"')) {
      buffer += unescapePo(line.slice(1, -1))
      continue
    }
    flush()
  }
  flush()
  return order
}

const NOTE_PREFIX = 'polyglots: '

// Our own notes are rewritten on every pass rather than appended, so resuming a
// run cannot stack duplicates, and a note disappears once its reason does.
// Comments that came from the source or from a contributor are left alone.
function setNotes(entry: GetTextTranslation, notes: string[]): void {
  const kept = splitLines(entry.comments?.translator).filter((line) => !line.startsWith(NOTE_PREFIX))
  const all = [...notes.map((n) => `${NOTE_PREFIX}${n}`), ...kept]
  const comments = { ...entry.comments }
  if (all.length > 0) comments.translator = all.join('\n')
  else delete comments.translator
  entry.comments = comments
}

function decode(buffer: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

export class PoFile {
  readonly nplurals: number

  constructor(
    readonly path: string,
    readonly raw: GetTextTranslations,
    private readonly order: Map<string, number> = new Map(),
  ) {
    this.nplurals = parseNplurals(raw.headers['Plural-Forms'])
  }

  get headers(): Record<string, string> {
    return this.raw.headers
  }

  private *entries(): Generator<GetTextTranslation> {
    for (const ctx of Object.keys(this.raw.translations)) {
      for (const msgid of Object.keys(this.raw.translations[ctx])) {
        if (ctx === '' && msgid === '') continue
        yield this.raw.translations[ctx][msgid]
      }
    }
  }

  private find(key: string): GetTextTranslation | undefined {
    const { msgctxt, msgid } = splitKey(key)
    return this.raw.translations[msgctxt]?.[msgid]
  }

  private rank(key: string): number {
    return this.order.get(key) ?? Number.MAX_SAFE_INTEGER
  }

  units(mode: UnitMode): TranslationUnit[] {
    const out: TranslationUnit[] = []
    for (const entry of this.entries()) {
      if (mode === 'pending' && !isUntranslated(entry) && !isFuzzy(entry)) continue
      out.push(toUnit(entry))
    }
    return out.sort((a, b) => this.rank(a.key) - this.rank(b.key))
  }

  auditEntries(): AuditEntry[] {
    const out: AuditEntry[] = []
    for (const entry of this.entries()) {
      const unit = toUnit(entry)
      out.push({ ...unit, msgstr: [...entry.msgstr], fuzzy: isFuzzy(entry) })
    }
    return out.sort((a, b) => this.rank(a.key) - this.rank(b.key))
  }

  // Reduces the file to the annotated entries, each marked fuzzy with its reasons
  // attached, so `translate` picks them up (fuzzy is what it selects by default).
  keepOnly(annotations: Map<string, string[]>): void {
    for (const ctx of Object.keys(this.raw.translations)) {
      for (const msgid of Object.keys(this.raw.translations[ctx])) {
        if (ctx === '' && msgid === '') continue
        const entry = this.raw.translations[ctx][msgid]
        const key = unitKey(entry.msgid, entry.msgctxt)
        const reasons = annotations.get(key)
        if (!reasons) {
          delete this.raw.translations[ctx][msgid]
          continue
        }
        setNotes(entry, reasons)
        const flags = flagList(entry).filter((f) => f !== 'fuzzy')
        flags.push('fuzzy')
        entry.comments = { ...entry.comments, flag: flags.join(', ') }
      }
      if (ctx !== '' && Object.keys(this.raw.translations[ctx]).length === 0) {
        delete this.raw.translations[ctx]
      }
    }
  }

  apply(results: ApplyResult[]): void {
    for (const result of results) {
      const entry = this.find(result.key)
      if (!entry) continue
      if (entry.msgid_plural !== undefined) {
        entry.msgstr = Array.from({ length: this.nplurals }, (_, i) => result.text[i] ?? '')
      } else {
        entry.msgstr = [result.text[0] ?? '']
      }
      const reason = result.fuzzy ? result.reason?.trim() : undefined
      setNotes(entry, reason ? [reason] : [])

      const flags = flagList(entry).filter((f) => f !== 'fuzzy')
      if (result.fuzzy) flags.push('fuzzy')
      if (flags.length === 0) {
        if (entry.comments) delete entry.comments.flag
      } else {
        entry.comments = { ...entry.comments, flag: flags.join(', ') }
      }
    }
  }

  async save(path: string = this.path, now: Date = new Date()): Promise<void> {
    const target = await realpath(path).catch(() => path)
    const mode = (await stat(target).catch(() => undefined))?.mode
    const stamp = { 'PO-Revision-Date': revisionDate(now), 'X-Generator': 'polyglots' }
    const buffer = po.compile(
      { ...this.raw, headers: { ...this.raw.headers, ...stamp } },
      { sort: (a, b) => this.rank(unitKey(a.msgid, a.msgctxt)) - this.rank(unitKey(b.msgid, b.msgctxt)) },
    )
    const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await writeFile(tmp, buffer)
      if (mode !== undefined) await chmod(tmp, mode & 0o7777)
      await rename(tmp, target)
    } catch (err) {
      await unlink(tmp).catch(() => undefined)
      throw err
    }
    if (path === this.path) Object.assign(this.raw.headers, stamp)
  }
}

export async function loadPo(path: string): Promise<PoFile> {
  const bytes = await readFile(path)
  const raw = po.parse(bytes)
  return new PoFile(path, raw, sourceOrder(decode(bytes, raw.charset)))
}
