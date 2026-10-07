import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { box, table } from '../../app/src/ui/layout.js'
import { createPainter, plainPainter } from '../../app/src/ui/paint.js'
import { ansiToHtml, ansiToText, Screen } from './ansi.js'

// The painter the CLI itself builds on a colour terminal. The demos go through
// it, so the converter is tested against what it really emits.
const p = createPainter({ isTTY: true, columns: 80 }, { LANG: 'en_US.UTF-8' })

test('each colour token becomes a span named for it', () => {
  assert.equal(ansiToHtml(`${p.paint('warn', '3')} flagged`), '<span class="t-warn">3</span> flagged')
  assert.equal(ansiToHtml(p.paint('success', 'ok')), '<span class="t-success">ok</span>')
  assert.equal(ansiToHtml(p.paint('muted', 'note')), '<span class="t-muted">note</span>')
})

test('a path is the accent colour, underlined', () => {
  assert.equal(ansiToHtml(p.paint('path', 'a.po')), '<span class="t-accent t-underline">a.po</span>')
})

test('bold is its own class, whichever token asked for it', () => {
  assert.equal(ansiToHtml(p.paint('heading', 'Top')), '<span class="t-bold">Top</span>')
})

test('text is escaped, inside a span and out', () => {
  assert.equal(ansiToHtml(`${p.paint('path', '<a&b>.po')} <i>`), '<span class="t-accent t-underline">&lt;a&amp;b&gt;.po</span> &lt;i&gt;')
})

test('box and table keep their columns once the colour is removed', () => {
  const rows = [['flagged', p.paint('warn', '12'), p.paint('muted', 'note')], ['approvable', '7', '']]
  const plainRows = [['flagged', '12', 'note'], ['approvable', '7', '']]
  const painted = box(p, p.paint('success', 'Reviewed'), table(rows, { align: ['left', 'right', 'left'] })).map(ansiToText)
  assert.deepEqual(painted, box(plainPainter, 'Reviewed', table(plainRows, { align: ['left', 'right', 'left'] })))
})

test('a sequence the converter does not know is dropped, never shown', () => {
  assert.equal(ansiToHtml('\x1b]8;;https://x\x07link\x1b]8;;\x07 \x1b[?25l'), 'link ')
})

test('the screen redraws a line in place on clear-line', () => {
  const s = new Screen()
  s.write('header\n')
  s.write('\r\x1b[2Kbatch 1/3')
  s.write('\r\x1b[2Knotice\n')
  s.write('\r\x1b[2Kbatch 2/3')
  assert.deepEqual(s.frame(), ['header', 'notice', 'batch 2/3'])
})
