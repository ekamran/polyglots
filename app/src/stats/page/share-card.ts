import { WEB_PALETTE } from '../../ui/web-palette.js'
import { count, percent, phrase, type PhraseKey, type StatsLanguage } from '../i18n.js'
import { esc, isoDay } from './html.js'
import type { StatsPayload } from './model.js'

// The image people post: a card drawn for the purpose, not a screenshot of
// the page. It carries totals and projects and nothing else. No contributor
// can appear on it, because nothing in a payload names one, and the card's
// input is the payload.
//
// It is rasterised in the browser through an <img> and a canvas, which forbids
// anything outside the SVG itself (a reference taints the canvas and the PNG
// never downloads) and rules out foreignObject, which Safari taints on sight.
// So: plain shapes, system fonts, and text shortened by character count
// rather than measured.
//
// Always the light palette, whatever the page theme: a shared image is seen on
// someone else's screen, and one look everywhere is the point of a card.

export const SHARE_WIDTH = 1200
export const SHARE_HEIGHT = 630

const FONT = `ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

export function shareCard(p: StatsPayload, lang: StatsLanguage): string {
  const c = WEB_PALETTE.light
  const t = (key: PhraseKey) => esc(phrase(key, lang))
  const n = (v: number) => esc(count(v, lang))
  const r = p.review

  const figures: Array<[string, string]> = [
    [n(r.entries), t('entries')],
    [n(r.submissions), t('submissions')],
    [esc(percent(r.problemRate, lang)), t('flagged')],
  ]
  if (p.translate.runs > 0) figures.push([n(p.translate.entries), t('drafted')])
  const figureSvg = figures
    .map(
      ([value, label], i) =>
        // Two by two: four figures in a row at this size run into the
        // projects column once a number reaches six digits.
        `<text x="${64 + (i % 2) * 330}" y="${272 + Math.floor(i / 2) * 104}" font-size="52" font-weight="700" fill="${c.fg}">${value}</text>` +
        `<text x="${64 + (i % 2) * 330}" y="${304 + Math.floor(i / 2) * 104}" font-size="20" fill="${c.muted}">${label}</text>`,
    )
    .join('')

  const weeks = r.byWeek.slice(-12)
  const peak = Math.max(1, ...weeks.map((w) => w.entries))
  const bars = weeks
    .map((w, i) => {
      const h = Math.round((w.entries / peak) * 90)
      return `<rect x="${64 + i * 46}" y="${540 - h}" width="34" height="${h}" rx="4" fill="${c.series[0]}"/>`
    })
    .join('')

  const top = [...r.byProject].sort((a, b) => b.entries - a.entries || a.project.localeCompare(b.project)).slice(0, 5)
  const most = Math.max(1, ...top.map((x) => x.entries))
  const projects = top
    .map((x, i) => {
      const y = 250 + i * 64
      const w = Math.max(4, Math.round((x.entries / most) * 290))
      return (
        `<text x="780" y="${y}" font-size="20" fill="${c.fg}">${esc(shorten(x.project, 30))}</text>` +
        `<rect x="780" y="${y + 12}" width="${w}" height="12" rx="6" fill="${c.series[1]}"/>` +
        `<text x="${780 + w + 10}" y="${y + 23}" font-size="16" fill="${c.muted}">${n(x.entries)}</text>`
      )
    })
    .join('')

  const span = r.from === undefined || r.to === undefined ? t('noneYet') : `${isoDay(r.from)} ${t('rangeTo')} ${isoDay(r.to)}`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}" font-family="${FONT}">` +
    `<rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="${c.bg}"/>` +
    `<rect x="24" y="24" width="${SHARE_WIDTH - 48}" height="${SHARE_HEIGHT - 48}" rx="24" fill="${c.panel}" stroke="${c.rule}"/>` +
    `<text x="64" y="96" font-size="22" font-weight="600" fill="${c.tokens.accent}">polyglots</text>` +
    `<text x="64" y="150" font-size="44" font-weight="700" fill="${c.fg}">${t('title')}</text>` +
    `<text x="64" y="190" font-size="22" fill="${c.muted}">${span}</text>` +
    figureSvg +
    bars +
    (top.length === 0 ? '' : `<text x="780" y="200" font-size="22" font-weight="600" fill="${c.fg}">${t('shareTop')}</text>`) +
    projects +
    `<text x="64" y="584" font-size="18" fill="${c.muted}">${t('shareTagline')}</text>` +
    `</svg>`
  )
}
