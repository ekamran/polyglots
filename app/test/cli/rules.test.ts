import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { main, type CliDeps } from '../../src/cli.js'
import { localeRulesFile } from '../../src/rules/load.js'

function sink() {
  return { isTTY: false, text: '', write(chunk: string) { this.text += chunk; return true } }
}

async function run(argv: string[], deps: Omit<CliDeps, 'streams'> = {}) {
  const stdout = sink()
  const stderr = sink()
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean }
  stdin.end()
  const code = await main(argv, { env: {}, ...deps, streams: { stdin, stdout, stderr } })
  return { code, stdout: stdout.text, stderr: stderr.text }
}

let home: string
let saved: NodeJS.ProcessEnv
beforeEach(async () => {
  saved = { ...process.env }
  home = await mkdtemp(join(tmpdir(), 'polyglots-cli-rules-'))
  process.env.POLYGLOTS_HOME = home
  // Named rather than assumed: polyglots has no default locale.
  await mkdir(join(home, 'config'), { recursive: true })
  await writeFile(join(home, 'config', 'config.json'), JSON.stringify({ defaultLocale: 'tr' }))
})
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
  await rm(home, { recursive: true, force: true })
})

async function writeRules(locale: string, text: string) {
  const file = localeRulesFile(locale)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text, 'utf8')
  return file
}

describe('rules path', () => {
  it('prints where the locale file lives, defaulting to the configured locale', async () => {
    const r = await run(['rules', 'path'])
    expect(r.stdout.trim()).toBe(localeRulesFile('tr'))
    expect((await run(['rules', 'path', 'sv'])).stdout.trim()).toBe(localeRulesFile('sv'))
  })
})

describe('rules check', () => {
  it('says the built-in defaults apply when there is no file', async () => {
    const r = await run(['rules', 'check'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/no rules file.*built-in/i)
  })

  it('summarises a valid file', async () => {
    await writeRules('tr', 'mistakes:\n  - wrong: önizleme\npatterns:\n  - text: x\n    replace: y\n    level: fix\nguidance: Be brief.\n')
    const r = await run(['rules', 'check'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/1 mistake/)
    expect(r.stdout).toMatch(/1 pattern/)
    expect(r.stdout).toMatch(/guidance: 9 of 1500 characters/)
  })

  it('names the file and line of an error and exits 1', async () => {
    const file = await writeRules('tr', 'rules:\n  enable: [nope]\n')
    const r = await run(['rules', 'check'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain(`${file}:2`)
  })
})

describe('rules edit', () => {
  it('writes the defaults when there is no file, opens the editor, then checks', async () => {
    const opened: string[] = []
    const r = await run(['rules', 'edit'], { openEditor: async (file) => void opened.push(file) })
    expect(opened).toEqual([localeRulesFile('tr')])
    expect(await readFile(localeRulesFile('tr'), 'utf8')).toMatch(/mistakes/)
    expect(r.code).toBe(0)
  })

  it('leaves an existing file as it is', async () => {
    await writeRules('tr', 'guidance: Mine.\n')
    await run(['rules', 'edit'], { openEditor: async () => {} })
    expect(await readFile(localeRulesFile('tr'), 'utf8')).toBe('guidance: Mine.\n')
  })

  it('reports a file left invalid by the edit', async () => {
    const r = await run(['rules', 'edit'], {
      openEditor: async (file) => writeFile(file, 'rules:\n  enable: [nope]\n', 'utf8'),
    })
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/nope/)
  })
})

// A review must not start on rules the person thinks are in force but are not.
describe('an invalid rules file', () => {
  it('stops a review before it starts, naming the file', async () => {
    const file = await writeRules('tr', 'rules:\n  enable: [nope]\n')
    const po = join(home, 'x-tr.po')
    await writeFile(po, 'msgid ""\nmsgstr ""\n', 'utf8')
    let called = false
    const r = await run(['review', po], { reviewFile: (async () => { called = true; return {} as never }) })
    expect(called).toBe(false)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain(file)
  })
})

// Duplication, not inheritance: the copy is its own file from then on.
describe('rules copy', () => {
  it('copies a locale file under the other locale, header renamed, everything else verbatim', async () => {
    await writeRules('nl', '# polyglots rules for nl_NL (nl)\n# my note\nmistakes:\n  - wrong: email\n    right: e-mail\n')
    const r = await run(['rules', 'copy', 'nl_NL', 'nl_BE'])
    expect(r.code).toBe(0)
    expect(await readFile(localeRulesFile('nl-be'), 'utf8')).toBe(
      '# polyglots rules for nl_BE (nl-be)\n# my note\nmistakes:\n  - wrong: email\n    right: e-mail\n',
    )
    expect(r.stdout).toMatch(/1 mistake/)
  })

  // The template's opening lines describe the locale it was written for. Left
  // as they were, a copy from Swedish told the Danish team about the Swedish
  // pack and how to check the Swedish file.
  it('rewrites the template lines that name the source locale', async () => {
    expect((await run(['rules', 'edit', 'sv'], { openEditor: async () => {} })).code).toBe(0)
    await run(['rules', 'copy', 'sv', 'da'])
    const copied = (await readFile(localeRulesFile('da'), 'utf8')).split('\n')
    expect(copied.slice(0, 2)).toEqual([
      '# polyglots rules for da_DK (da)',
      '# No built-in pack for da: only the universal rules run unless this file adds some.',
    ])
    expect(copied).toContain('# Check the file with: polyglots rules check da')
    expect(copied.join('\n')).not.toMatch(/Built-in pack: Swedish|rules check sv/)
  })

  it('drops the pack line when the target has a maintained pack, and adds one when it leaves one', async () => {
    await run(['rules', 'edit', 'sv'], { openEditor: async () => {} })
    await run(['rules', 'copy', 'sv', 'tr'])
    const toTurkish = (await readFile(localeRulesFile('tr'), 'utf8')).split('\n')
    expect(toTurkish.slice(0, 2)).toEqual(['# polyglots rules for tr_TR (tr)', '#'])

    await run(['rules', 'copy', 'tr', 'de'])
    const fromTurkish = (await readFile(localeRulesFile('de'), 'utf8')).split('\n')
    expect(fromTurkish.slice(0, 3)).toEqual([
      '# polyglots rules for de_DE (de)',
      '# No built-in pack for de: only the universal rules run unless this file adds some.',
      '#',
    ])
  })

  it('copies to a translation set, accepting any spelling of the locales', async () => {
    await writeRules('de', 'guidance: Siezen.\n')
    await run(['rules', 'copy', 'de', 'de_DE_formal'])
    expect(await readFile(localeRulesFile('de/formal'), 'utf8')).toBe('guidance: Siezen.\n')
  })

  it('refuses to overwrite an existing file unless forced', async () => {
    await writeRules('nl', 'guidance: Source.\n')
    await writeRules('nl-be', 'guidance: Mine.\n')
    const refused = await run(['rules', 'copy', 'nl', 'nl-be'])
    expect(refused.code).toBe(2)
    expect(refused.stderr).toMatch(/--force/)
    expect(await readFile(localeRulesFile('nl-be'), 'utf8')).toBe('guidance: Mine.\n')
    await run(['rules', 'copy', 'nl', 'nl-be', '--force'])
    expect(await readFile(localeRulesFile('nl-be'), 'utf8')).toBe('guidance: Source.\n')
  })

  it('refuses when the source has no file', async () => {
    const r = await run(['rules', 'copy', 'nl', 'nl-be'])
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/no rules file/i)
  })

  // A broken file copied is two broken files.
  it('refuses to copy an invalid file', async () => {
    await writeRules('nl', 'rules:\n  enable: [nope]\n')
    const r = await run(['rules', 'copy', 'nl', 'nl-be'])
    expect(r.code).toBe(1)
  })
})


describe('rules check: built-in pack', () => {
  it('names a maintained pack', async () => {
    expect((await run(['rules', 'check', 'tr'])).stdout).toContain('Built-in pack: Turkish (maintained)')
  })

  it('names a pack of defaults for the team to confirm', async () => {
    expect((await run(['rules', 'check', 'sv'])).stdout).toContain('Built-in pack: Swedish (defaults for the locale team to confirm)')
  })

  it('says when there is no pack, with or without a file', async () => {
    const line = 'No built-in pack for de: only the universal rules run unless this file adds some.'
    expect((await run(['rules', 'check', 'de'])).stdout).toContain(line)
    await writeRules('de', 'guidance: Kurz.\n')
    const r = await run(['rules', 'check', 'de'])
    expect(r.stdout).toContain(line)
    expect(r.stdout).toMatch(/^✓ \S+ is valid\.$/m)
  })
})
