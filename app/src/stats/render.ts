import type { EngineRow, ProjectRow, ReviewStats, TranslateStats, WeekRow } from './query.js'
import { BUILT_IN_LANGUAGES, ENGLISH, count, duration, phrase, type PhraseKey, type StatsLanguage } from './i18n.js'

// Everything is inline. The page has to open from an email attachment, on a
// machine that has never heard of this tool, years after it was written, so it
// carries no script, no stylesheet link and no remote font. That rules out a
// charting library: a CDN link is a page that works until it does not, and
// bundling one inline costs more than the few dozen lines of SVG below.
//
// It also rules out scripted switches, so the theme and language controls are
// hidden radios that CSS reads with :has(). The page carries every language at
// once and shows one; that is a few hundred bytes per language against keeping
// the file inert, which is the property that makes it safe to send to anyone.

// Adjacent segments have to be told apart at a glance, so this varies hue and
// lightness together rather than stepping down one blue ramp.
const PALETTE = ['#2a6f97', '#e07a5f', '#81b29a', '#f2cc8f', '#6b705c', '#9d8189']

// A project name is text a contributor chose, and real ones carry ampersands
// ("Malware Removal &amp; Auto Cleanup"). Unescaped it would also let a name
// close a tag and rewrite the rest of the page.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// The tag in a class name and a selector: lowercase, so pt-BR and pt-br are one
// language, and already held to [a-z0-9-] by the build step that embeds it.
const slug = (lang: StatsLanguage) => lang.tag.toLowerCase()

// Every language, side by side, all but one hidden. The lang attribute is not
// decoration: without lang="tr", `text-transform: uppercase` renders
// "istatistik" as "ISTATISTIK" rather than "İSTATİSTİK", which is the exact
// class of mistake this tool exists to catch in other people's work. English
// goes without one because the document already says it.
function each(langs: readonly StatsLanguage[], text: (lang: StatsLanguage) => string): string {
  return langs
    .map((lang) =>
      lang === ENGLISH
        ? `<span class="l en">${text(lang)}</span>`
        : `<span class="l ${slug(lang)}" lang="${lang.tag}">${text(lang)}</span>`,
    )
    .join('')
}

// Set once per render, so the section builders below stay as they were when
// the page had exactly two languages and did not need them passed down.
let langs: readonly StatsLanguage[] = [ENGLISH]

function say(key: PhraseKey): string {
  return each(langs, (lang) => escapeHtml(phrase(key, lang)))
}

// A figure printed once in a neutral format would be wrong in all but one
// language: Turkish groups thousands with a dot.
function num(n: number): string {
  return each(langs, (lang) => count(n, lang))
}

function took(ms: number): string {
  return each(langs, (lang) => escapeHtml(duration(ms, lang)))
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function day(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

function figure(value: string, key: PhraseKey): string {
  return `<figure class="stat"><b>${value}</b><figcaption>${say(key)}</figcaption></figure>`
}

function weeklyChart(weeks: WeekRow[], heading: PhraseKey): string {
  if (weeks.length === 0) return ''
  const peak = Math.max(...weeks.map((w) => w.entries))
  const width = 100 / weeks.length
  const bars = weeks
    .map((w, i) => {
      // A week with no entries still gets a bar of zero height rather than a
      // division by zero, and the whole chart survives an all-empty peak.
      const height = peak === 0 ? 0 : (w.entries / peak) * 100
      const x = i * width
      return (
        `<rect class="bar" x="${(x + width * 0.2).toFixed(2)}" y="${(100 - height).toFixed(2)}" ` +
        `width="${(width * 0.6).toFixed(2)}" height="${height.toFixed(2)}" rx="0.6">` +
        `<title>${escapeHtml(w.week)}: ${count(w.entries, ENGLISH)}</title>` +
        `</rect>`
      )
    })
    .join('')
  // Labels are HTML, not SVG text. The bars are drawn in a stretched viewBox so
  // they fill the width whatever the week count, and that same stretch turns
  // text into smears.
  const labels = weeks.map((w) => `<span>${escapeHtml(w.week.slice(5))}</span>`).join('')
  return `<section><h2>${say(heading)}</h2>
<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="bars" role="img">${bars}</svg>
<div class="ticks">${labels}</div>
<p class="peak">${say('peak')} ${num(peak)} ${say('entries')}</p></section>`
}

// Segments are strokes on one circle rather than arc paths: the dash maths is
// one multiplication per segment, where an arc path is four trig calls and a
// large-arc flag to get wrong.
function categoryDonut(stats: ReviewStats): string {
  const entries = Object.entries(stats.byCategory)
  if (entries.length === 0) return ''
  const total = entries.reduce((n, [, v]) => n + v, 0)
  if (total === 0) return ''
  const radius = 15.9155 // circumference 100, so a dash length is a percentage
  let offset = 0
  const segments = entries
    .map(([name, n], i) => {
      const share = (n / total) * 100
      const seg =
        `<circle class="seg" cx="21" cy="21" r="${radius}" fill="none" ` +
        `stroke="${PALETTE[i % PALETTE.length]}" stroke-width="6" ` +
        `stroke-dasharray="${share.toFixed(3)} ${(100 - share).toFixed(3)}" ` +
        `stroke-dashoffset="${(-offset).toFixed(3)}"><title>${escapeHtml(name)}</title></circle>`
      offset += share
      return seg
    })
    .join('')
  const legend = entries
    .map(
      ([name, n], i) =>
        `<li><i style="background:${PALETTE[i % PALETTE.length]}"></i>` +
        `<span class="name">${escapeHtml(name)}</span><b>${percent(n / total)}</b>` +
        `<small>${num(n)}</small></li>`,
    )
    .join('')
  return `<section><h2>${say('donutHeading')}</h2><div class="donut-row">
<svg viewBox="0 0 42 42" class="donut" role="img">
<circle cx="21" cy="21" r="${radius}" fill="none" stroke="var(--rule)" stroke-width="6"></circle>
${segments}</svg>
<ul class="legend">${legend}</ul></div></section>`
}

function projectTable(rows: ProjectRow[], runsLabel: PhraseKey): string {
  if (rows.length === 0) return ''
  const body = rows
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.project)}</td><td>${num(p.runs)}</td>` +
        `<td>${num(p.entries)}</td><td>${num(p.flagged)}</td>` +
        `<td>${p.entries === 0 ? '—' : percent(p.flagged / p.entries)}</td></tr>`,
    )
    .join('')
  return `<section><h2>${say('projectHeading')}</h2><table>
<thead><tr><th>${say('colProject')}</th><th>${say(runsLabel)}</th><th>${say('colEntries')}</th>
<th>${say('colFlagged')}</th><th>${say('colRate')}</th></tr></thead>
<tbody>${body}</tbody></table></section>`
}

// Only drawn when more than one engine ran: a table comparing a thing to
// itself is a row of numbers pretending to be a comparison.
function engineTable(rows: EngineRow[]): string {
  if (rows.length < 2) return ''
  const body = rows
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.engine)}</td><td>${num(e.runs)}</td>` +
        `<td>${num(e.entries)}</td>` +
        `<td>${e.entries === 0 ? '—' : percent(e.flagged / e.entries)}</td>` +
        `<td>${
          e.medianTurnaroundMs === undefined
            ? '—'
            : took(e.medianTurnaroundMs)
        }</td></tr>`,
    )
    .join('')
  return `<section><h2>${say('engineHeading')}</h2><table>
<thead><tr><th>${say('colEngine')}</th><th>${say('colRuns')}</th><th>${say('colEntries')}</th>
<th>${say('colRate')}</th><th>${say('colMedian')}</th></tr></thead>
<tbody>${body}</tbody></table></section>`
}

// Controls are radios rather than a checkbox so "auto" stays reachable: a
// shared page should match whatever the reader's machine already prefers
// unless they say otherwise.
function controls(): string {
  const theme = (['auto', 'light', 'dark'] as const)
    .map((name, i) => {
      const key = `theme${name[0]!.toUpperCase()}${name.slice(1)}` as PhraseKey
      return (
        `<input type="radio" name="theme" id="theme-${name}" class="sw"${i === 0 ? ' checked' : ''}>` +
        `<label for="theme-${name}">${say(key)}</label>`
      )
    })
    .join('')
  // The language code alone reads best (EN, TR), until two languages share it
  // and only the full tag tells pt-BR from pt-PT.
  const primary = (lang: StatsLanguage) => lang.tag.split('-')[0]!
  const label = (lang: StatsLanguage) =>
    (langs.filter((l) => primary(l) === primary(lang)).length > 1 ? lang.tag : primary(lang)).toUpperCase()
  const lang =
    langs.length < 2
      ? ''
      : `<div class="group">${langs
          .map(
            (l, i) =>
              `<input type="radio" name="lang" id="lang-${slug(l)}" class="sw"${i === 0 ? ' checked' : ''}>` +
              `<label for="lang-${slug(l)}">${label(l)}</label>`,
          )
          .join('')}</div>`
  return `<div class="bar-controls"><div class="group">${theme}</div>${lang}</div>`
}

const STYLE = `:root{--ink:#14202b;--dim:#5b6b7a;--bg:#fbfcfd;--card:#fff;--rule:#e6ecf1;--accent:#2a6f97;--on:#eef3f7}
@media(prefers-color-scheme:dark){:root{--ink:#e8eef3;--dim:#93a4b3;--bg:#11181f;--card:#18212a;--rule:#25313c;--on:#21303c}}
:root:has(#theme-light:checked){--ink:#14202b;--dim:#5b6b7a;--bg:#fbfcfd;--card:#fff;--rule:#e6ecf1;--on:#eef3f7}
:root:has(#theme-dark:checked){--ink:#e8eef3;--dim:#93a4b3;--bg:#11181f;--card:#18212a;--rule:#25313c;--on:#21303c}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1rem 3rem;background:var(--bg);color:var(--ink);
font:16px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:52rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .2rem}
h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);margin:0 0 .9rem}
.span{color:var(--dim);margin:0 0 1.6rem;font-size:.9rem}
section{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:1.3rem;margin-bottom:1.1rem}
.stats{display:flex;flex-wrap:wrap;gap:1.6rem}
.stat{margin:0}
.stat b{display:block;font-size:1.9rem;line-height:1.1;font-variant-numeric:tabular-nums}
.stat figcaption{color:var(--dim);font-size:.8rem;margin-top:.15rem}
.bars{width:100%;height:150px;display:block}
.bar{fill:var(--accent)}
.ticks{display:flex;margin-top:.4rem}
.ticks span{flex:1;text-align:center;font-size:.7rem;color:var(--dim)}
.peak{margin:.5rem 0 0;font-size:.7rem;color:var(--dim)}
.donut-row{display:flex;gap:1.6rem;align-items:center;flex-wrap:wrap}
.donut{width:150px;height:150px;flex:none;transform:rotate(-90deg)}
.legend{list-style:none;margin:0;padding:0;flex:1;min-width:14rem}
.legend li{display:flex;align-items:center;gap:.55rem;padding:.25rem 0}
.legend i{width:.7rem;height:.7rem;border-radius:2px;flex:none}
.legend .name{flex:1}
.legend b{font-variant-numeric:tabular-nums}
.legend small{color:var(--dim);width:4rem;text-align:right;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th{text-align:left;color:var(--dim);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
th,td{padding:.45rem .5rem;border-bottom:1px solid var(--rule)}
td:not(:first-child),th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
.note{color:var(--dim);font-size:.85rem;margin:1.4rem 0 0}
.empty{color:var(--dim)}
.section-title{font-size:1.15rem;text-transform:none;letter-spacing:0;color:var(--ink);margin:2.4rem 0 .9rem}
.sw{position:absolute;opacity:0;pointer-events:none}
.bar-controls{display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap;margin:0 0 1rem}
.group{display:flex;border:1px solid var(--rule);border-radius:7px;overflow:hidden;background:var(--card)}
.group label{padding:.28rem .7rem;font-size:.78rem;color:var(--dim);cursor:pointer;border-right:1px solid var(--rule)}
.group label:last-child{border-right:0}
.sw:checked+label{background:var(--on);color:var(--ink)}
.sw:focus-visible+label{outline:2px solid var(--accent);outline-offset:-2px}
.l:not(.en){display:none}`

// One pair of rules per language besides English, which shows by default.
function languageStyle(): string {
  return langs
    .filter((lang) => lang !== ENGLISH)
    .map(
      (lang) =>
        `\n:root:has(#lang-${slug(lang)}:checked) .l:not(.${slug(lang)}){display:none}` +
        `\n:root:has(#lang-${slug(lang)}:checked) .l.${slug(lang)}{display:inline}`,
    )
    .join('')
}

function translateSection(t: TranslateStats): string {
  if (t.runs === 0) return ''
  const incomplete =
    t.incomplete === 0
      ? ''
      : ` ${num(t.incomplete)} ${say(t.incomplete === 1 ? 'incompleteOne' : 'incompleteMany')}`
  return `<h2 class="section-title">${say('translateHeading')}</h2>
<section><div class="stats">
${figure(num(t.runs), 'runs')}
${figure(num(t.entries), 'drafted')}
${figure(percent(t.fuzzyRate), 'leftFuzzy')}
${t.skipped === 0 ? '' : figure(num(t.skipped), 'skippedEntries')}
${
  t.medianTurnaroundMs === undefined
    ? ''
    : figure(took(t.medianTurnaroundMs), 'turnaround')
}
</div></section>
${weeklyChart(t.byWeek, 'translateWeekly')}
${engineTable(t.byEngine)}
${projectTable(t.byProject, 'colRuns')}
<p class="note">${say('translateCaveat')}${incomplete}</p>`
}

/**
 * One self-contained HTML page carrying every language, with CSS-only theme and
 * language switches. Takes the numbers and nothing else, so the counts can be
 * asserted without parsing markup.
 */
export interface RenderOptions {
  translate?: TranslateStats
  now?: Date
  // The languages besides English; the ones built from i18n/stats by default.
  languages?: readonly StatsLanguage[]
}

export function renderStats(stats: ReviewStats, options: RenderOptions = {}): string {
  const now = options.now ?? new Date()
  langs = [ENGLISH, ...(options.languages ?? BUILT_IN_LANGUAGES)]
  const span =
    stats.from === undefined || stats.to === undefined
      ? say('noneYet')
      : `${day(stats.from)} ${say('rangeTo')} ${day(stats.to)}`

  const headline =
    stats.submissions === 0
      ? `<section><p class="empty">${say('emptyBody')}</p></section>`
      : `<section><div class="stats">
${figure(num(stats.submissions), 'submissions')}
${figure(num(stats.entries), 'entries')}
${figure(percent(stats.problemRate), 'flagged')}
${figure(num(stats.repaired), 'repaired')}
${
  stats.medianTurnaroundMs === undefined
    ? ''
    : figure(took(stats.medianTurnaroundMs), 'turnaround')
}
</div></section>`

  const incomplete =
    stats.incomplete === 0
      ? ''
      : ` ${num(stats.incomplete)} ${say(stats.incomplete === 1 ? 'incompleteOne' : 'incompleteMany')}`

  const caveat = stats.submissions === 0 ? '' : `<p class="note">${say('caveat')}${incomplete}</p>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(['polyglots', ...langs.map((lang) => phrase('title', lang))].join(' · '))}</title>
<style>${STYLE}${languageStyle()}</style></head>
<body>
${controls()}
<main>
<h1>${say('title')}</h1>
<p class="span">${span} · ${say('generated')} ${day(now.getTime())}</p>
${headline}
${weeklyChart(stats.byWeek, 'weeklyHeading')}
${categoryDonut(stats)}
${projectTable(stats.byProject, 'colSubmissions')}
${engineTable(stats.byEngine)}
${caveat}
${options.translate ? translateSection(options.translate) : ''}
</main></body></html>`
}
