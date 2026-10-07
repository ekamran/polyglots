import type { DayRow, WeekRow } from '../query.js'
import { ruleText } from '../i18n.js'
import type { FlagRow } from './model.js'
import { esc, type Say } from './html.js'

// Charts are SVG strings built here rather than a charting library: a library
// would have to be bundled inline (the page loads nothing from outside), and
// it would cost more bytes than these few functions. Colours are classes, not
// attributes, so the theme switch restyles a chart without redrawing it.

/**
 * Bars for entries per week. Drawn in a stretched viewBox so they fill the
 * width whatever the week count; the labels are HTML beside it, because the
 * same stretch turns SVG text into smears.
 */
export function weeklyBars(weeks: WeekRow[], s: Say): string {
  if (weeks.length === 0) return ''
  const peak = Math.max(...weeks.map((w) => w.entries))
  const width = 100 / weeks.length
  const bars = weeks
    .map((w, i) => {
      // An all-empty peak still draws: zero-height bars, not a division by zero.
      const h = peak === 0 ? 0 : (w.entries / peak) * 100
      return (
        `<rect class="bar" x="${(i * width + width * 0.15).toFixed(2)}" y="${(100 - h).toFixed(2)}" ` +
        `width="${(width * 0.7).toFixed(2)}" height="${h.toFixed(2)}">` +
        `<title>${esc(w.week)}: ${s.n(w.entries)} ${s.t('entries')}</title></rect>`
      )
    })
    .join('')
  // A label under every bar stops fitting past a dozen weeks; every k-th one
  // keeps the axis readable on a phone.
  const every = Math.max(1, Math.ceil(weeks.length / 8))
  const ticks = weeks
    .map((w, i) => `<span>${i % every === 0 ? esc(w.week.slice(5)) : ''}</span>`)
    .join('')
  return (
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="bars" role="img" ` +
    `aria-label="${s.t('peak')} ${s.n(peak)} ${s.t('entries')}">${bars}</svg>` +
    `<div class="ticks" aria-hidden="true">${ticks}</div>` +
    `<p class="small muted">${s.t('peak')} ${s.n(peak)} ${s.t('entries')}</p>`
  )
}

/**
 * A year of review days, GitHub style: 53 columns of weeks, Monday on top.
 * The year ends on the day the payload was generated, so the rightmost column
 * is this week.
 */
export function heatmap(days: DayRow[], generatedAt: number, s: Say): string {
  const byDay = new Map(days.map((d) => [d.day, d.entries]))
  const end = new Date(generatedAt)
  // Local midnight of the last day, then back to the Monday 52 weeks before
  // the week it falls in, so every column is a whole week.
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const back = (last.getDay() + 6) % 7
  const first = new Date(last.getFullYear(), last.getMonth(), last.getDate() - back - 52 * 7)
  const values = [...byDay.values()].filter((v) => v > 0)
  const peak = values.length === 0 ? 0 : Math.max(...values)
  const level = (v: number) => (v === 0 || peak === 0 ? 0 : Math.min(4, Math.ceil((v / peak) * 4)))
  const cell = 11
  const pad = (n: number) => String(n).padStart(2, '0')
  const cells: string[] = []
  for (let i = 0; ; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    if (d.getTime() > last.getTime()) break
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const v = byDay.get(key) ?? 0
    const col = Math.floor(i / 7)
    const row = i % 7
    cells.push(
      `<rect class="h${level(v)}" x="${col * cell}" y="${row * cell}" width="${cell - 2}" height="${cell - 2}" rx="2">` +
        `<title>${key}: ${s.n(v)} ${s.t('entries')}</title></rect>`,
    )
  }
  const legend = [0, 1, 2, 3, 4]
    .map((l) => `<svg width="10" height="10" aria-hidden="true"><rect class="h${l}" width="10" height="10" rx="2"/></svg>`)
    .join('')
  return (
    `<div class="scroll"><svg class="heat" viewBox="0 0 ${53 * cell} ${7 * cell}" width="${53 * cell}" height="${7 * cell}" ` +
    `role="img" aria-label="${s.t('activityHeading')}">${cells.join('')}</svg></div>` +
    `<p class="heat-legend small muted">${s.t('activityLess')} ${legend} ${s.t('activityMore')}</p>`
  )
}

function tipAttrs(title: string, body: string, meta: string): string {
  return `data-tip-title="${esc(title)}" data-tip-body="${esc(body)}" data-tip-meta="${esc(meta)}"`
}

const GROUP_HEADING = { rule: 'flagsRule', ai: 'flagsAi', process: 'flagsProcess', other: 'flagsOther' } as const

/**
 * What gets flagged: a donut of every flag by key, a thin inner ring that
 * splits rule checks from AI findings, and a legend grouped the same way with
 * counts and shares, so colour never carries the meaning alone.
 *
 * Segments are strokes on one circle rather than arc paths: the dash maths is
 * one multiplication per segment, where an arc is four trig calls and a
 * large-arc flag to get wrong.
 */
export function flagDonut(rows: FlagRow[], s: Say): string {
  const total = rows.reduce((n, r) => n + r.count, 0)
  if (total === 0) return ''
  const r = 15.9155 // circumference 100, so a dash length is a percentage
  let offset = 0
  const segments = rows
    .map((row, i) => {
      const share = (row.count / total) * 100
      const text = ruleText(row.key, s.lang)
      const meta = `${s.n(row.count)} · ${s.tn('flagShare', s.pct(row.count / total))}`
      const seg =
        `<circle class="slice k${i % 8}" cx="21" cy="21" r="${r}" fill="none" stroke-width="5.5" ` +
        `stroke-dasharray="${share.toFixed(3)} ${(100 - share).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}" ` +
        `tabindex="0" role="img" aria-label="${esc(text.name)}: ${s.n(row.count)}, ${s.pct(row.count / total)}" ` +
        `${tipAttrs(text.name, text.description, meta)}><title>${esc(text.name)}</title></circle>`
      offset += share
      return seg
    })
    .join('')

  // The inner ring: rule checks against everything the model said.
  const split = (['rule', 'ai'] as const).map((src) => rows.filter((x) => x.source === src).reduce((n, x) => n + x.count, 0))
  let inner = 0
  const ring = split
    .map((n, i) => {
      if (n === 0) return ''
      const share = (n / total) * 100
      const out =
        `<circle class="${i === 0 ? 'ring-rule' : 'ring-ai'}" cx="21" cy="21" r="11" fill="none" stroke-width="2" ` +
        `pathLength="100" stroke-dasharray="${share.toFixed(3)} ${(100 - share).toFixed(3)}" stroke-dashoffset="${(-inner).toFixed(3)}"></circle>`
      inner += share
      return out
    })
    .join('')

  const groups = (['rule', 'ai', 'process', 'other'] as const)
    .map((source) => {
      const members = rows.map((row, i) => ({ row, i })).filter(({ row }) => row.source === source)
      if (members.length === 0) return ''
      const sum = members.reduce((n, m) => n + m.row.count, 0)
      const items = members
        .map(({ row, i }) => {
          const text = ruleText(row.key, s.lang)
          const meta = `${s.n(row.count)} · ${s.tn('flagShare', s.pct(row.count / total))}`
          return (
            `<li tabindex="0" ${tipAttrs(text.name, text.description, meta)}>` +
            `<svg width="12" height="12" aria-hidden="true"><rect class="f${i % 8}" width="12" height="12" rx="3"/></svg>` +
            `<span class="name">${esc(text.name)}</span><b>${s.pct(row.count / total)}</b><small>${s.n(row.count)}</small></li>`
          )
        })
        .join('')
      return (
        `<li class="group"><span class="group-name ${source}">${s.t(GROUP_HEADING[source])}</span>` +
        `<small>${s.pct(sum / total)}</small></li>${items}`
      )
    })
    .join('')

  return (
    `<div class="donut-row"><svg viewBox="0 0 42 42" class="donut" role="group" aria-label="${s.t('donutHeading')}">` +
    `<circle cx="21" cy="21" r="${r}" fill="none" class="track" stroke-width="5.5"></circle>${segments}${ring}</svg>` +
    `<ul class="legend">${groups}</ul></div>` +
    `<p class="small muted">${s.t('flagsShareNote')}</p>`
  )
}

/** How long reviews take, as horizontal bars per bucket. */
export function turnaroundBars(buckets: number[], s: Say): string {
  const peak = Math.max(0, ...buckets)
  if (peak === 0) return ''
  const keys = ['bucket0', 'bucket1', 'bucket2', 'bucket3', 'bucket4', 'bucket5'] as const
  const rows = buckets
    .map(
      (n, i) =>
        `<div class="hbar"><span>${s.t(keys[i]!)}</span>` +
        `<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="bar" width="${((n / peak) * 100).toFixed(2)}" height="10" rx="1"/></svg>` +
        `<b>${s.n(n)}</b></div>`,
    )
    .join('')
  return `<div class="hbars">${rows}</div>`
}

/** A rate as a bar inside a table cell, so the outliers show without reading. */
export function rateBar(fraction: number): string {
  const w = Math.max(0, Math.min(1, fraction)) * 100
  return (
    `<svg class="rate" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">` +
    `<rect class="track" width="100" height="6" rx="3"/><rect class="bar" width="${w.toFixed(2)}" height="6" rx="3"/></svg>`
  )
}
