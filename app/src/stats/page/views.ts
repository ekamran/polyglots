import type { EngineRow, ProjectRow, ReviewStats, TranslateStats } from '../query.js'
import { ENGLISH, type PhraseKey, type StatsLanguage } from '../i18n.js'
import { flagDonut, heatmap, rateBar, turnaroundBars, weeklyBars } from './charts.js'
import { esc, isoDay, sayer, type Say } from './html.js'
import { RANGES, flagRows, type Range, type StatsPayload } from './model.js'

// The whole visible page as one string, from the payload and a language. The
// server calls it for the first paint, so the page reads without JavaScript;
// the browser calls the same function to redraw when the range or language
// changes. One renderer, so the two can never disagree.

export const VIEWS = ['overview', 'reviews', 'translation', 'projects', 'method'] as const
export type View = (typeof VIEWS)[number]

const NAV: Record<View, PhraseKey> = {
  overview: 'navOverview',
  reviews: 'navReviews',
  translation: 'navTranslation',
  projects: 'navProjects',
  method: 'navMethod',
}

const RANGE_LABEL: Record<Range, PhraseKey> = { '30d': 'range30d', '90d': 'range90d', '1y': 'range1y', all: 'rangeAll' }

export interface PageContext {
  payload: StatsPayload
  lang: StatsLanguage
  // Every language this copy carries, English first, for the switcher.
  languages: readonly StatsLanguage[]
}

// How many projects the table shows before "Show all". Ten is a screenful on
// a laptop and still the whole list for most locales' plugin sets.
export const PROJECTS_SHOWN = 10

function card(value: string, label: string, context: string): string {
  return (
    `<figure class="card"><b>${value}</b><figcaption>${label}</figcaption>` +
    `${context === '' ? '' : `<small>${context}</small>`}</figure>`
  )
}

function panel(heading: string, body: string): string {
  if (body === '') return ''
  return `<section class="panel"><h3>${heading}</h3>${body}</section>`
}

function span(stats: { from?: number; to?: number }, s: Say): string {
  return stats.from === undefined || stats.to === undefined
    ? s.t('noneYet')
    : `${isoDay(stats.from)} ${s.t('rangeTo')} ${isoDay(stats.to)}`
}

function incomplete(n: number, s: Say): string {
  return n === 0 ? '' : ` ${s.n(n)} ${s.t(n === 1 ? 'incompleteOne' : 'incompleteMany')}`
}

interface Column {
  label: string
  numeric: boolean
}

interface Cell {
  html: string
  // What the column sorts by: the raw number for a figure, the plain text for
  // a name. Kept beside the formatted text because "1.234" sorts as text in
  // Turkish and as a decimal in English, and neither is the number.
  v: number | string
}

function sortableTable(cols: Column[], rows: Cell[][], extraClass = ''): string {
  const head = cols
    .map(
      (c, i) =>
        `<th scope="col" aria-sort="none"${c.numeric ? ' class="num"' : ''}>` +
        `<button type="button" data-sort="${i}"${c.numeric ? ' data-numeric' : ''}>${c.label}<span class="dir" aria-hidden="true"></span></button></th>`,
    )
    .join('')
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${cols[i]!.numeric ? ' class="num"' : ''} data-v="${esc(String(c.v))}">${c.html}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<div class="scroll"><table class="sortable ${extraClass}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function projectRows(rows: ProjectRow[], s: Say): Cell[][] {
  return rows.map((p) => {
    const rate = p.entries === 0 ? 0 : p.flagged / p.entries
    return [
      { html: esc(p.project), v: p.project },
      { html: s.n(p.runs), v: p.runs },
      { html: s.n(p.entries), v: p.entries },
      { html: s.n(p.flagged), v: p.flagged },
      {
        html: p.entries === 0 ? '—' : `<span class="rate-cell">${rateBar(rate)}<span>${s.pct(rate)}</span></span>`,
        v: rate,
      },
    ]
  })
}

function projectColumns(runs: PhraseKey, s: Say): Column[] {
  return [
    { label: s.t('colProject'), numeric: false },
    { label: s.t(runs), numeric: true },
    { label: s.t('colEntries'), numeric: true },
    { label: s.t('colFlagged'), numeric: true },
    { label: s.t('colRate'), numeric: true },
  ]
}

// Only drawn when more than one engine ran: a table comparing a thing to
// itself is a row of numbers pretending to be a comparison.
function engineTable(rows: EngineRow[], s: Say): string {
  if (rows.length < 2) return ''
  const cols: Column[] = [
    { label: s.t('colEngine'), numeric: false },
    { label: s.t('colRuns'), numeric: true },
    { label: s.t('colEntries'), numeric: true },
    { label: s.t('colRate'), numeric: true },
    { label: s.t('colMedian'), numeric: true },
  ]
  const cells = rows.map((e): Cell[] => [
    { html: esc(e.engine), v: e.engine },
    { html: s.n(e.runs), v: e.runs },
    { html: s.n(e.entries), v: e.entries },
    { html: e.entries === 0 ? '—' : s.pct(e.flagged / e.entries), v: e.entries === 0 ? 0 : e.flagged / e.entries },
    { html: e.medianTurnaroundMs === undefined ? '—' : s.dur(e.medianTurnaroundMs), v: e.medianTurnaroundMs ?? 0 },
  ])
  return sortableTable(cols, cells)
}

/**
 * The projects table: the biggest ten in view, and every project behind a
 * <details>, which works without JavaScript. The full table carries the filter
 * box, because filtering ten rows is not a task anyone has.
 */
function projectsBlock(rows: ProjectRow[], runs: PhraseKey, s: Say): string {
  if (rows.length === 0) return ''
  const sorted = [...rows].sort((a, b) => b.entries - a.entries || a.project.localeCompare(b.project))
  const cols = projectColumns(runs, s)
  const top = sortableTable(cols, projectRows(sorted.slice(0, PROJECTS_SHOWN), s), 'proj-top')
  if (sorted.length <= PROJECTS_SHOWN) return top
  return (
    `<div class="projects">${top}<details><summary>${s.tn('showAll', s.n(sorted.length))}</summary>` +
    `<label class="filter js-only"><span>${s.t('filterProjects')}</span><input type="search" data-filter autocomplete="off"></label>` +
    `${sortableTable(cols, projectRows(sorted, s), 'proj-all')}</details></div>`
  )
}

function overview(p: StatsPayload, s: Say): string {
  const r = p.review
  const t = p.translate
  const last30 = (n: number) => (p.range === '30d' ? '' : s.tn('inLast30', s.n(n)))
  if (r.submissions === 0 && t.runs === 0) {
    return `<section class="panel"><p class="muted">${s.t('emptyBody')}</p></section>`
  }
  const cards = [
    r.submissions === 0 ? '' : card(s.n(r.entries), s.t('entries'), last30(p.recent.entries)),
    r.submissions === 0 ? '' : card(s.n(r.submissions), s.t('submissions'), last30(p.recent.submissions)),
    r.submissions === 0 ? '' : card(s.pct(r.problemRate), s.t('flagged'), `${s.n(r.flagged)} ${s.t('entries')}`),
    r.medianTurnaroundMs === undefined
      ? ''
      : card(s.dur(r.medianTurnaroundMs), s.t('turnaround'), `${s.n(r.repaired)} ${s.t('repaired')}`),
    t.runs === 0 ? '' : card(s.n(t.entries), s.t('drafted'), last30(p.recent.drafted)),
  ].join('')
  return (
    `<div class="cards">${cards}</div>` +
    panel(s.t('activityHeading'), heatmap(p.activity, p.generatedAt, s)) +
    panel(s.t('weeklyHeading'), weeklyBars(r.byWeek, s)) +
    `<p class="js-only share"><button type="button" data-share>${s.t('shareImage')}</button></p>`
  )
}

function reviews(r: ReviewStats, s: Say): string {
  if (r.submissions === 0) return `<section class="panel"><p class="muted">${s.t('emptyBody')}</p></section>`
  return (
    panel(s.t('donutHeading'), flagDonut(flagRows(r.byCategory), s)) +
    panel(s.t('turnaroundHeading'), turnaroundBars(r.turnaroundBuckets, s)) +
    panel(s.t('engineHeading'), engineTable(r.byEngine, s)) +
    `<p class="note">${s.t('caveat')}${incomplete(r.incomplete, s)}</p>`
  )
}

function translation(t: TranslateStats, s: Say): string {
  if (t.runs === 0) return `<section class="panel"><p class="muted">${s.t('noTranslate')}</p></section>`
  const cards = [
    card(s.n(t.runs), s.t('runs'), ''),
    card(s.n(t.entries), s.t('drafted'), ''),
    card(s.pct(t.fuzzyRate), s.t('leftFuzzy'), `${s.n(t.fuzzy)} ${s.t('entries')}`),
    t.skipped === 0 ? '' : card(s.n(t.skipped), s.t('skippedEntries'), ''),
    t.medianTurnaroundMs === undefined ? '' : card(s.dur(t.medianTurnaroundMs), s.t('turnaround'), ''),
  ].join('')
  return (
    `<div class="cards">${cards}</div>` +
    panel(s.t('translateWeekly'), weeklyBars(t.byWeek, s)) +
    panel(s.t('engineHeading'), engineTable(t.byEngine, s)) +
    panel(s.t('projectHeading'), projectsBlock(t.byProject, 'colRuns', s)) +
    `<p class="note">${s.t('translateCaveat')}${incomplete(t.incomplete, s)}</p>`
  )
}

function projects(r: ReviewStats, s: Say): string {
  if (r.byProject.length === 0) return `<section class="panel"><p class="muted">${s.t('emptyBody')}</p></section>`
  return panel(s.t('projectHeading'), projectsBlock(r.byProject, 'colSubmissions', s))
}

function method(s: Say): string {
  const keys: PhraseKey[] = ['methodEntries', 'caveat', 'methodSplit', 'methodTurnaround', 'methodDays', 'methodNoRanking']
  return `<section class="panel prose"><h3>${s.t('methodHeading')}</h3>${keys.map((k) => `<p>${s.t(k)}</p>`).join('')}</section>`
}

// The language's own short code reads best (EN, TR), until two languages
// share it and only the full tag tells pt-BR from pt-PT.
function languageLabel(lang: StatsLanguage, all: readonly StatsLanguage[]): string {
  const primary = (l: StatsLanguage) => l.tag.split('-')[0]!
  const shared = all.filter((l) => primary(l) === primary(lang)).length > 1
  return (shared ? lang.tag : primary(lang)).toUpperCase()
}

function controls(ctx: PageContext, s: Say): string {
  const { payload, lang, languages } = ctx
  const query = (range: Range, tag: string) => `?range=${range}${tag === ENGLISH.tag ? '' : `&amp;lang=${esc(tag)}`}`
  const ranges = RANGES.map(
    (r) =>
      `<a href="${query(r, lang.tag)}" data-range="${r}"${r === payload.range ? ' aria-current="true"' : ''}>${s.t(RANGE_LABEL[r])}</a>`,
  ).join('')
  const langs =
    languages.length < 2
      ? ''
      : `<div class="seg" role="group" aria-label="${s.t('language')}">${languages
          .map(
            (l) =>
              `<a href="${query(payload.range, l.tag)}" data-lang="${esc(l.tag)}" lang="${esc(l.tag)}"` +
              `${l.tag === lang.tag ? ' aria-current="true"' : ''}>${esc(languageLabel(l, languages))}</a>`,
          )
          .join('')}</div>`
  const themes = (['auto', 'light', 'dark'] as const)
    .map(
      (name) =>
        `<button type="button" data-theme-set="${name}" aria-pressed="false">${s.t(
          `theme${name[0]!.toUpperCase()}${name.slice(1)}` as PhraseKey,
        )}</button>`,
    )
    .join('')
  return (
    `<div class="controls"><div class="seg" role="group" aria-label="${s.t('rangeLabel')}">${ranges}</div>` +
    `${langs}<div class="seg js-only" role="group" aria-label="${s.t('theme')}">${themes}</div></div>`
  )
}

/** Everything inside the page's root element. */
export function renderRoot(ctx: PageContext): string {
  const s = sayer(ctx.lang)
  const p = ctx.payload
  const running = p.review.running
  const nav = VIEWS.map((v) => `<a href="#${v}" data-view="${v}">${s.t(NAV[v])}</a>`).join('')
  const sections: Record<View, string> = {
    overview: overview(p, s),
    reviews: reviews(p.review, s),
    translation: translation(p.translate, s),
    projects: projects(p.review, s),
    method: method(s),
  }
  return (
    `<header class="top"><div class="brand"><span class="product">polyglots</span>` +
    `<h1>${s.t('title')}</h1></div>${controls(ctx, s)}</header>` +
    `<nav class="tabs" aria-label="${s.t('title')}">${nav}</nav>` +
    `<p class="span muted">${span(p.review, s)} · ${s.t('generated')} ${isoDay(p.generatedAt)}</p>` +
    (running === 0
      ? ''
      : `<p class="running" role="status">${s.tn(running === 1 ? 'runningOne' : 'runningMany', s.n(running))}</p>`) +
    `<p class="busy" role="status" hidden>${s.t('busy')}</p>` +
    VIEWS.map(
      (v) => `<section class="view" id="${v}" aria-labelledby="h-${v}"><h2 id="h-${v}">${s.t(NAV[v])}</h2>${sections[v]}</section>`,
    ).join('') +
    `<footer class="muted small">polyglots · ${s.t('generated')} ${isoDay(p.generatedAt)}</footer>`
  )
}
