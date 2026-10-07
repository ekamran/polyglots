import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { box, table } from '../../app/src/ui/layout.js'
import { htmlPainter, lineToHtml, lineToText, Screen } from './html-painter.js'

test('a painted run becomes a span named for its token', () => {
  const p = htmlPainter()
  assert.equal(lineToHtml(`${p.paint('warn', '3')} flagged`), '<span class="t-warn">3</span> flagged')
})

test('text is escaped, including inside a span', () => {
  const p = htmlPainter()
  assert.equal(lineToHtml(p.paint('path', '<a&b>.po')), '<span class="t-path">&lt;a&amp;b&gt;.po</span>')
})

test('box and table pad painted cells exactly as they pad plain ones', () => {
  const p = htmlPainter()
  const plain = { ...p, color: false, paint: (_t: string, s: string) => s }
  const rows = [['flagged', p.paint('warn', '12'), p.paint('muted', 'note')], ['approvable', '7', '']]
  const plainRows = [['flagged', '12', 'note'], ['approvable', '7', '']]
  const painted = box(p, p.paint('success', 'Reviewed'), table(rows, { align: ['left', 'right', 'left'] })).map(lineToText)
  const expected = box(plain, 'Reviewed', table(plainRows, { align: ['left', 'right', 'left'] }))
  assert.deepEqual(painted, expected)
})

test('a stray SGR sequence is dropped, not rendered or trusted', () => {
  assert.equal(lineToHtml('\x1b[32mok\x1b[39m <b>'), 'ok &lt;b&gt;')
})

test('an unclosed span is closed at the end of the line', () => {
  assert.equal(lineToHtml('\x1b]8;;pg:accent\x07cut'), '<span class="t-accent">cut</span>')
})

test('the screen redraws a line in place on clear-line', () => {
  const s = new Screen()
  s.write('header\n')
  s.write('\r\x1b[2Kbatch 1/3')
  s.write('\r\x1b[2Knotice\n')
  s.write('\r\x1b[2Kbatch 2/3')
  assert.deepEqual(s.frame(), ['header', 'notice', 'batch 2/3'])
})
