import { basename } from 'node:path'
import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { UNIVERSAL_RULES } from '../../audit/rules/profiles.js'
import { openRulesDraft, saveRulesDraft, type RulesDraft, type RulesValue } from '../../rules/edit.js'
import { BUILT_IN_RULES } from '../../rules/names.js'
import { GUIDANCE_LIMIT } from '../../rules/schema.js'
import { resolveLocale, wpCodeOf } from '../../wporg/locales.js'
import { useConfig } from '../commands.js'
import { Hint } from '../components/Hint.js'
import { ListEditor } from '../components/ListEditor.js'

export interface LocaleRulesProps {
  onBack: () => void
}

type Stage = 'pick' | 'overview' | 'rules' | 'ratio' | 'nouns' | 'nounList' | 'mistakes' | 'leave'

const SECTIONS = ['Built-in rules', 'Glossary match', 'Proper nouns', 'Common mistakes'] as const
const SECTION_STAGE: Stage[] = ['rules', 'ratio', 'nouns', 'mistakes']
type NounList = 'always' | 'dateOnly'
const NOUN_LISTS: { key: NounList; label: string }[] = [
  { key: 'always', label: 'Always capitalized' },
  { key: 'dateOnly', label: 'Only in a specific date' },
]
type Mistake = RulesValue['mistakes'][number]

const describeMistake = (m: Mistake) => `${m.wrong}${m.right ? ` → ${m.right}` : ''}${m.note ? `  (${m.note})` : ''}`
const RATIO_STEP = 0.05

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const round = (n: number) => Math.round(n * 100) / 100

/**
 * The menu's editor for a locale's rules file.
 *
 * Edits are held on the screen and written only on `s`, through the same
 * save `rules edit` would leave you with: comments a person wrote stay, only
 * changed sections are touched, and nothing invalid reaches the disk. Leaving
 * with unsaved edits asks first. Saving says what it costs: the rules feed
 * configHash, so the next review of every file in the locale starts over.
 */
export function LocaleRules({ onBack }: LocaleRulesProps) {
  const { config } = useConfig()
  const [stage, setStage] = useState<Stage>('pick')
  const [input, setInput] = useState(config.defaultLocale)
  const [draft, setDraft] = useState<RulesDraft>()
  const [value, setValue] = useState<RulesValue>({ mistakes: [], patterns: [] })
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [cursor, setCursor] = useState(0)
  const [ruleCursor, setRuleCursor] = useState(0)
  const [nounCursor, setNounCursor] = useState(0)

  const dirty = draft !== undefined && JSON.stringify(value) !== JSON.stringify(draft.value)
  const id = draft?.locale ?? ''

  const activeRules = (): Set<string> =>
    value.rules
      ? new Set([...UNIVERSAL_RULES, ...value.rules.enable].filter((r) => !value.rules!.disable.includes(r)))
      : new Set(draft?.builtIn.rules ?? [])
  const ratio = value.glossaryStemRatio ?? draft?.builtIn.glossaryStemRatio ?? 0.7

  const open = (raw: string) => {
    const resolved = resolveLocale(raw)
    if (!resolved) {
      setError(`Locale "${raw.trim()}" is not listed on translate.wordpress.org`)
      return
    }
    try {
      const opened = openRulesDraft(resolved.id)
      setDraft(opened)
      setValue(opened.value)
      setError(undefined)
      setStage('overview')
    } catch (err) {
      setError(errorText(err))
    }
  }

  const save = async () => {
    if (!draft) return
    try {
      const next = await saveRulesDraft(draft, value)
      setDraft(next)
      setValue(next.value)
      setError(undefined)
      setNotice(`Saved ${basename(next.path)}.`)
    } catch (err) {
      setNotice(undefined)
      setError(errorText(err))
    }
  }

  const toggle = (rule: string) => {
    const rules = activeRules()
    if (rules.has(rule)) rules.delete(rule)
    else rules.add(rule)
    setValue({
      ...value,
      rules: {
        enable: [...rules].filter((r) => !UNIVERSAL_RULES.includes(r)),
        disable: UNIVERSAL_RULES.filter((r) => !rules.has(r)),
      },
    })
    setNotice(undefined)
  }

  const nouns = (list: NounList): string[] => value.properNouns?.[list] ?? draft?.builtIn.properNouns[list] ?? []
  // A list edited for the first time is written out whole, built-in names
  // included, since a list in the file replaces the built-in one. The other
  // list stays out of the file and so stays built-in.
  const setNouns = (list: NounList, names: string[]) => {
    setValue({ ...value, properNouns: { ...(value.properNouns ?? {}), [list]: names } })
    setNotice(undefined)
  }

  useInput((ch, key) => {
    // The list editors own their keys.
    if (stage === 'mistakes' || stage === 'nounList') return
    if (stage === 'nouns') {
      if (key.escape) setStage('overview')
      else if (key.upArrow || key.downArrow) setNounCursor((c) => (c === 0 ? 1 : 0))
      else if (key.return) setStage('nounList')
      return
    }
    if (stage === 'pick') {
      if (key.escape) onBack()
      return
    }
    if (stage === 'leave') {
      if (ch === 's') void save().then(() => setStage('overview'))
      else if (ch === 'd') onBack()
      else if (key.escape) setStage('overview')
      return
    }
    if (stage === 'rules') {
      if (key.escape) setStage('overview')
      else if (key.upArrow) setRuleCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow) setRuleCursor((c) => Math.min(BUILT_IN_RULES.length - 1, c + 1))
      else if (key.return || ch === ' ') toggle(BUILT_IN_RULES[ruleCursor]!)
      return
    }
    if (stage === 'ratio') {
      if (key.escape) setStage('overview')
      else if (key.leftArrow || key.rightArrow) {
        const next = round(Math.min(1, Math.max(RATIO_STEP, ratio + (key.leftArrow ? -RATIO_STEP : RATIO_STEP))))
        setValue({ ...value, glossaryStemRatio: next })
        setNotice(undefined)
      } else if (ch === 'r') {
        const { glossaryStemRatio: _, ...rest } = value
        setValue(rest)
      }
      return
    }
    // overview
    if (key.escape || (ch === 'q' && !key.ctrl)) {
      if (dirty) setStage('leave')
      else onBack()
    } else if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
    else if (key.downArrow) setCursor((c) => Math.min(SECTIONS.length - 1, c + 1))
    else if (key.return) setStage(SECTION_STAGE[cursor]!)
    else if (ch === 's' && dirty) void save()
  })

  const marker = (selected: boolean) => (selected ? '❯ ' : '  ')
  const header = draft ? `${wpCodeOf(id) ?? id} (${id})` : ''

  return (
    <Box flexDirection="column">
      <Text bold>
        Locale rules{header ? ` · ${header}` : ''}
        {dirty ? <Text color="yellow">  unsaved changes</Text> : null}
      </Text>

      {stage === 'pick' && (
        <>
          <Box>
            <Text>Locale: </Text>
            <TextInput value={input} onChange={setInput} onSubmit={open} />
          </Box>
          <Text dimColor>Any spelling: tr, tr_TR, nl_NL_formal, nl/formal.</Text>
          {error && <Text color="red">{error}</Text>}
          <Hint>enter to open · esc back to menu</Hint>
        </>
      )}

      {draft && stage !== 'pick' && (
        <Text dimColor>{draft.exists ? draft.path : `No file yet: built-in defaults apply. Saving creates ${basename(draft.path)}.`}</Text>
      )}

      {draft && (stage === 'overview' || stage === 'leave') && (
        <>
          <Text>
            {marker(cursor === 0)}Built-in rules     {activeRules().size} on
          </Text>
          <Text>
            {marker(cursor === 1)}Glossary match     {ratio.toFixed(2)}
          </Text>
          <Text>
            {marker(cursor === 2)}Proper nouns       {nouns('always').length} always · {nouns('dateOnly').length} date-only
          </Text>
          <Text>{`${marker(cursor === 3)}Common mistakes    ${value.mistakes.length}`}</Text>
          <Text dimColor>{`  Patterns           ${value.patterns.length}`}</Text>
          <Text dimColor>{`  Guidance           ${value.guidance?.trim().length ?? 0} of ${GUIDANCE_LIMIT} characters`}</Text>
          <Text dimColor>  Patterns and guidance are edited with: polyglots rules edit {id}</Text>
          {dirty && (
            <Text color="yellow">
              Saving changes the rules for {id}: the next review of every {id} file starts over.
            </Text>
          )}
          {notice && <Text color="green">{notice}</Text>}
          {error && <Text color="red">{error}</Text>}
          {stage === 'leave' ? (
            <Text color="yellow">Unsaved changes. s save · d discard and leave · esc keep editing</Text>
          ) : (
            <Hint>{dirty ? '↑↓ move · enter open · s save · esc back' : '↑↓ move · enter open · esc back'}</Hint>
          )}
        </>
      )}

      {draft && stage === 'rules' && (
        <>
          {BUILT_IN_RULES.map((rule, i) => (
            <Text key={rule}>
              {marker(i === ruleCursor)}[{activeRules().has(rule) ? 'x' : ' '}] {rule.padEnd(14)}
              <Text dimColor>{UNIVERSAL_RULES.includes(rule) ? 'universal' : 'opt-in'}</Text>
            </Text>
          ))}
          <Hint>↑↓ move · space toggle · esc back to the overview</Hint>
        </>
      )}

      {draft && stage === 'nouns' && (
        <>
          {NOUN_LISTS.map((l, i) => (
            <Text key={l.key}>
              {marker(i === nounCursor)}
              {l.label.padEnd(26)}
              <Text dimColor>
                {nouns(l.key).length} names{value.properNouns?.[l.key] ? '' : ', built-in'}
              </Text>
            </Text>
          ))}
          <Hint>↑↓ move · enter open · esc back to the overview</Hint>
        </>
      )}

      {draft && stage === 'nounList' && (
        <ListEditor<string>
          title={NOUN_LISTS[nounCursor]!.label}
          items={nouns(NOUN_LISTS[nounCursor]!.key)}
          empty="No names."
          describe={(n) => n}
          fields={[{ key: 'name', label: 'Name', required: true }]}
          toForm={(n) => ({ name: n })}
          fromForm={(v) => v.name!.trim()}
          onChange={(names) => setNouns(NOUN_LISTS[nounCursor]!.key, names)}
          onBack={() => setStage('nouns')}
        />
      )}

      {draft && stage === 'mistakes' && (
        <ListEditor<Mistake>
          title="Common mistakes"
          items={value.mistakes}
          empty="No mistakes yet. A match goes to the AI review with your note."
          describe={describeMistake}
          fields={[
            { key: 'wrong', label: 'Wrong', required: true },
            { key: 'right', label: 'Right' },
            { key: 'note', label: 'Note' },
          ]}
          toForm={(m) => ({ wrong: m.wrong, right: m.right ?? '', note: m.note ?? '' })}
          fromForm={(v) => ({
            wrong: v.wrong!.trim(),
            ...(v.right?.trim() ? { right: v.right.trim() } : {}),
            ...(v.note?.trim() ? { note: v.note.trim() } : {}),
          })}
          onChange={(mistakes) => {
            setValue({ ...value, mistakes })
            setNotice(undefined)
          }}
          onBack={() => setStage('overview')}
        />
      )}

      {draft && stage === 'ratio' && (
        <>
          <Text>
            Glossary match: {ratio.toFixed(2)}
            <Text dimColor>  built-in {draft.builtIn.glossaryStemRatio.toFixed(2)}</Text>
          </Text>
          <Text dimColor>How much of a glossary term an inflected form must keep to count as using it.</Text>
          <Hint>←→ change · r back to built-in · esc back to the overview</Hint>
        </>
      )}
    </Box>
  )
}
