import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openJobsDb } from '../../../src/jobs/index.js'
import { translateFile, type TranslateOptions } from '../../../src/commands/translate.js'
import { fakeEngine, fakeReview, makeWorkspace, type Workspace } from './helpers.js'

let ws: Workspace

beforeEach(async () => {
  ws = await makeWorkspace()
})

afterEach(async () => {
  await ws.cleanup()
})

function base(overrides: Partial<TranslateOptions> = {}): TranslateOptions {
  return {
    file: ws.file,
    locale: 'tr',
    mode: 'pending',
    draftEngine: 'deepl',
    mcpConfigPath: join(ws.home, 'mcp.json'),
    batchSize: 25,
    ...overrides,
  }
}

const RU = 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);'

async function rewrite(edit: (text: string) => string) {
  await writeFile(ws.file, edit(await readFile(ws.file, 'utf8')), 'utf8')
}

const dropHeader = (text: string) => text.replace(/"Plural-Forms:[^\n]*\n/, '')

describe('translateFile: Plural-Forms', () => {
  // How many forms a locale has is not something to guess: two forms written
  // into a Russian catalogue are wrong in every plural entry.
  it('refuses a catalogue with plural entries and no Plural-Forms header, before any engine or job row', async () => {
    await rewrite(dropHeader)
    const engine = fakeEngine()
    const review = fakeReview()
    await expect(translateFile(base({ engine, review }))).rejects.toThrow(
      `${ws.file} has plural entries but no Plural-Forms header; polyglots will not guess how many forms tr uses`,
    )
    expect(engine.calls).toHaveLength(0)
    expect(review.calls).toHaveLength(0)
    const jobs = openJobsDb()
    try {
      expect((jobs.prepare('SELECT count(*) AS n FROM run').get() as { n: number }).n).toBe(0)
    } finally {
      jobs.close()
    }
  })

  // xgettext and wp i18n make-pot both write this placeholder, so a fresh .pot
  // has the header and still says nothing. Saying the header is missing sends
  // a new user looking for something that is plainly in the file.
  it('names the template placeholder rather than calling the header missing', async () => {
    await rewrite((text) =>
      text.replace(/"Plural-Forms:[^\n]*\n/, '"Plural-Forms: nplurals=INTEGER; plural=EXPRESSION;\\n"\n'),
    )
    const engine = fakeEngine()
    const run = translateFile(base({ engine, review: fakeReview() }))
    await expect(run).rejects.toThrow(
      `${ws.file} still has the template's Plural-Forms placeholder (nplurals=INTEGER); set the header for tr, or start from the tr .po on translate.wordpress.org`,
    )
    expect(engine.calls).toHaveLength(0)
  })

  it('runs a catalogue with no plural entries and no header', async () => {
    await rewrite((text) =>
      dropHeader(text)
        .split('\n\n')
        .filter((block) => !block.includes('msgid_plural'))
        .join('\n\n'),
    )
    expect(await readFile(ws.file, 'utf8')).not.toMatch(/msgid_plural/)
    const summary = await translateFile(base({ engine: fakeEngine(), review: fakeReview() }))
    expect(summary.translated).toBeGreaterThan(0)
  })

  it('hands the review the Plural-Forms header above two forms', async () => {
    await rewrite((text) => text.replace(/"Plural-Forms:[^\n]*\n/, `"Plural-Forms: ${RU}\\n"\n`))
    const review = fakeReview()
    await translateFile(base({ locale: 'ru', engine: fakeEngine(), review }))
    expect(review.calls[0]?.opts.pluralForms).toBe(RU)
  })

  // The header is in the review prompt above two forms and not in the draft
  // prompt, so changing it must re-ask the review of a plural draft while the
  // draft itself stays served from cache. The file is put back to its pending
  // state before each run, since a run writes its drafts into it. The control
  // run with the header unchanged proves both caches are live, so the second
  // review is the header's doing.
  it('re-reviews a plural draft when only the Plural-Forms header changes, without redrafting it', async () => {
    const CS = 'nplurals=3; plural=(n==1 ? 0 : n>=2 && n<=4 ? 1 : 2);'
    const pending = ws.original.toString('utf8')
    const engine = fakeEngine()
    const review = fakeReview()
    const reviewed: string[][] = []
    const run = async (expression: string) => {
      await writeFile(ws.file, pending.replace(/"Plural-Forms:[^\n]*\n/, `"Plural-Forms: ${expression}\\n"\n`), 'utf8')
      const before = review.calls.length
      await translateFile(base({ locale: 'ru', engine, review }))
      reviewed.push(review.calls.slice(before).flatMap((c) => c.inputs.map((i) => i.msgid)))
    }
    await run(RU)
    const drafted = engine.calls.length
    expect(drafted).toBeGreaterThan(0)
    expect(reviewed[0]).toContain('One submission was deleted.')
    await run(RU)
    expect(reviewed[1]).toEqual([])
    await run(CS)
    expect(reviewed[2]).toContain('One submission was deleted.')
    expect(engine.calls.length).toBe(drafted)
  })

  it('leaves it out at two forms', async () => {
    const review = fakeReview()
    await translateFile(base({ engine: fakeEngine(), review }))
    expect(review.calls[0]?.opts).not.toHaveProperty('pluralForms')
  })
})
