import { createHash } from 'node:crypto'
import { WEB_PALETTE, type WebSurface } from '../ui/web-palette.js'
import { CLIENT_JS } from './client-bundle.js'
import { BUILT_IN_LANGUAGES, ENGLISH, phrase, type StatsLanguage } from './i18n.js'
import type { BootData } from './page/client.js'
import { esc } from './page/html.js'
import type { Range, StatsPayload } from './page/model.js'
import { renderRoot } from './page/views.js'

// The page around the views: head, style, the inline client and the data it
// starts from. Shared by the server and the standalone copy, which differ only
// in mode and in how many ranges they carry.
//
// Nothing loads from outside. The style and the script are inline and pinned
// by hash in a content security policy, sent as a header by the server and
// repeated in a meta tag so the mailed copy has the same fence: an attachment
// that someone edits cannot be turned into a page that phones home.

const HEAT: Record<'light' | 'dark', string[]> = {
  light: ['#ebeff3', '#b6d7ea', '#6fb0d6', '#2c7fb8', '#0b4f80'],
  dark: ['#21262d', '#0e4a6e', '#1769a0', '#3b92d1', '#79c0ff'],
}

function vars(t: WebSurface, heat: string[]): string {
  const series = t.series.map((c, i) => `--s${i}:${c}`).join(';')
  return (
    `--bg:${t.bg};--fg:${t.fg};--panel:${t.panel};--rule:${t.rule};--muted:${t.muted};` +
    `--accent:${t.tokens.accent};--warn:${t.tokens.warn};--error:${t.tokens.error};--success:${t.tokens.success};` +
    `${series};${heat.map((c, i) => `--h${i}:${c}`).join(';')}`
  )
}

const LIGHT = vars(WEB_PALETTE.light, HEAT.light)
const DARK = vars(WEB_PALETTE.dark, HEAT.dark)

// Series classes: k strokes a donut segment, f fills a swatch, from one list.
const SERIES = Array.from({ length: 8 }, (_, i) => `.k${i}{stroke:var(--s${i})}.f${i}{fill:var(--s${i})}`).join('')

export const STYLE =
  `:root{${LIGHT};color-scheme:light}` +
  `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK};color-scheme:dark}}` +
  `:root[data-theme="dark"]{${DARK};color-scheme:dark}` +
  `*{box-sizing:border-box}` +
  `body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}` +
  `#root{max-width:66rem;margin:0 auto;padding:1.25rem 1rem 3rem}` +
  `a{color:var(--accent)}` +
  `button{font:inherit;color:inherit}` +
  `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}` +
  `.top{display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:center;justify-content:space-between}` +
  `.brand{display:flex;flex-direction:column}` +
  `.product{color:var(--accent);font-weight:600;font-size:.85rem;letter-spacing:.02em}` +
  `h1{font-size:1.45rem;margin:0;line-height:1.2}` +
  `.controls{display:flex;flex-wrap:wrap;gap:.5rem}` +
  `.seg{display:flex;border:1px solid var(--rule);border-radius:8px;overflow:hidden;background:var(--panel)}` +
  `.seg a,.seg button{padding:.3rem .7rem;font-size:.8rem;color:var(--muted);text-decoration:none;border:0;border-right:1px solid var(--rule);background:none;cursor:pointer}` +
  `.seg>:last-child{border-right:0}` +
  `.seg [aria-current="true"],.seg [aria-pressed="true"]{background:var(--bg);color:var(--fg);font-weight:600}` +
  `.tabs{display:flex;gap:.25rem;margin:1.1rem 0 .4rem;border-bottom:1px solid var(--rule);overflow-x:auto}` +
  `.tabs a{padding:.55rem .8rem;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap}` +
  `.tabs a[aria-current="page"]{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}` +
  `.span{margin:.2rem 0 1rem;font-size:.85rem}` +
  `.muted{color:var(--muted)}.small{font-size:.8rem}` +
  `.running,.busy{border:1px solid var(--rule);border-left:3px solid var(--warn);background:var(--panel);padding:.5rem .8rem;border-radius:6px;font-size:.9rem}` +
  `.view{margin-bottom:2rem}` +
  `.view>h2{font-size:1.1rem;margin:1.5rem 0 .8rem}` +
  `html.js .view{display:none}html.js .view.active{display:block}` +
  // The section heading stays for screen readers once the tabs name the view.
  `html.js .view>h2{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}` +
  `html:not(.js) .js-only{display:none}` +
  `.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr));gap:.75rem;margin-bottom:1rem}` +
  `.card{margin:0;background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:.9rem 1rem}` +
  `.card b{display:block;font-size:1.75rem;line-height:1.15;font-variant-numeric:tabular-nums}` +
  `.card figcaption{color:var(--fg);font-size:.85rem}` +
  `.card small{display:block;color:var(--muted);font-size:.78rem;margin-top:.15rem}` +
  `.panel{background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:1rem 1.1rem;margin-bottom:1rem;min-width:0}` +
  `.panel h3{font-size:.95rem;margin:0 0 .8rem}` +
  `.scroll{overflow-x:auto;max-width:100%}` +
  `.bars{width:100%;height:150px;display:block}.bar{fill:var(--accent)}` +
  `.ticks{display:flex;margin-top:.3rem}.ticks span{flex:1;text-align:center;font-size:.68rem;color:var(--muted);white-space:nowrap;overflow:visible}` +
  `.heat{display:block}.heat-legend{display:flex;align-items:center;gap:.25rem;margin:.4rem 0 0}` +
  [0, 1, 2, 3, 4].map((i) => `.h${i}{fill:var(--h${i})}`).join('') +
  `.donut-row{display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start}` +
  `.donut{width:170px;height:170px;flex:none;transform:rotate(-90deg)}` +
  `.donut .track{stroke:var(--rule)}.ring-rule{stroke:var(--accent)}.ring-ai{stroke:var(--warn)}` +
  `.slice{cursor:pointer}` +
  SERIES +
  `.legend{list-style:none;margin:0;padding:0;flex:1;min-width:15rem}` +
  `.legend li{display:flex;align-items:center;gap:.55rem;padding:.22rem .3rem;border-radius:5px}` +
  `.legend li[tabindex]:hover,.legend li[tabindex]:focus-visible{background:var(--bg)}` +
  `.legend li.group{margin-top:.6rem;padding-left:0;font-weight:600;font-size:.8rem;color:var(--muted)}` +
  `.legend li.group:first-child{margin-top:0}` +
  `.group-name{flex:1;border-left:3px solid var(--muted);padding-left:.45rem}` +
  `.group-name.rule{border-color:var(--accent)}.group-name.ai{border-color:var(--warn)}` +
  `.legend .name{flex:1}.legend b{font-variant-numeric:tabular-nums}` +
  `.legend small{color:var(--muted);min-width:3.5rem;text-align:right;font-variant-numeric:tabular-nums}` +
  `.hbars{display:grid;gap:.35rem}` +
  `.hbar{display:grid;grid-template-columns:7rem 1fr 3.5rem;align-items:center;gap:.6rem;font-size:.85rem}` +
  `.hbar svg{width:100%;height:10px}.hbar b{text-align:right;font-variant-numeric:tabular-nums}` +
  `table{width:100%;border-collapse:collapse;font-size:.88rem}` +
  `th{text-align:left;font-weight:600;font-size:.75rem;color:var(--muted);white-space:nowrap}` +
  `th button{background:none;border:0;padding:0;cursor:pointer;color:inherit;font-weight:inherit;text-transform:inherit}` +
  `th .dir{display:inline-block;width:1em;margin-left:.15rem}` +
  `th,td{padding:.45rem .5rem;border-bottom:1px solid var(--rule)}` +
  `.num{text-align:right;font-variant-numeric:tabular-nums}th.num button{text-align:right}` +
  `tbody tr:last-child td{border-bottom:0}` +
  `.rate-cell{display:inline-flex;align-items:center;gap:.4rem}` +
  `.rate{width:4.5rem;height:6px}.rate .track{fill:var(--rule)}` +
  `details{margin-top:.6rem}summary{cursor:pointer;color:var(--accent);padding:.3rem 0}` +
  `.projects:has(details[open]) .top{display:none}` +
  `.filter{display:flex;gap:.5rem;align-items:center;margin:.5rem 0;font-size:.85rem;color:var(--muted)}` +
  `.filter input{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--rule);border-radius:6px;padding:.3rem .5rem;min-width:0;flex:1;max-width:18rem}` +
  `.note{color:var(--muted);font-size:.85rem;margin:1rem 0 0}` +
  `.prose p{max-width:44rem}` +
  `.share button{border:1px solid var(--rule);background:var(--panel);border-radius:8px;padding:.45rem .9rem;cursor:pointer}` +
  `#tip{position:absolute;z-index:10;max-width:280px;background:var(--fg);color:var(--bg);border-radius:8px;padding:.55rem .7rem;font-size:.8rem;line-height:1.4;box-shadow:0 4px 16px rgb(0 0 0/.18);pointer-events:none}` +
  `#tip strong,#tip span{display:block}#tip span+span{opacity:.8;margin-top:.2rem}` +
  `footer{margin-top:2rem}` +
  `@media (max-width:40rem){.hbar{grid-template-columns:5.5rem 1fr 3rem}.donut{width:140px;height:140px}}`

export interface DocumentOptions {
  mode: 'server' | 'static'
  range: Range
  // The server's copy carries the range it painted; the standalone copy
  // carries all four, so its range buttons work with no server behind them.
  payloads: Partial<Record<Range, StatsPayload>>
  lang: StatsLanguage
  languages?: readonly StatsLanguage[]
}

export interface RenderedDocument {
  html: string
  // The policy the server also sends as a header.
  csp: string
}

const hash = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

// A script element ends at the first "</script" whatever the JavaScript
// around it means, so the inlined bundle and the JSON both have "<" escaped.
// In the bundle "<\/" is the same string to the parser; in the JSON "<"
// is the same character.
const inlineScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1')
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export function renderDocument(opts: DocumentOptions): RenderedDocument {
  const languages = opts.languages ?? [ENGLISH, ...BUILT_IN_LANGUAGES]
  const payload = opts.payloads[opts.range]
  if (!payload) throw new Error(`renderDocument: no payload for range ${opts.range}`)
  const script = inlineScript(CLIENT_JS)
  const data: BootData = { mode: opts.mode, range: opts.range, lang: opts.lang.tag, payloads: opts.payloads }
  const csp = [
    "default-src 'none'",
    `script-src ${hash(script)}`,
    `style-src ${hash(STYLE)}`,
    // The share card goes SVG to <img> to canvas through blob: URLs.
    'img-src data: blob:',
    ...(opts.mode === 'server' ? ["connect-src 'self'"] : []),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const html =
    `<!doctype html>\n<html lang="${esc(opts.lang.tag)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<title>polyglots · ${esc(phrase('title', opts.lang))}</title>` +
    `<style>${STYLE}</style></head><body>` +
    `<div id="root">${renderRoot({ payload, lang: opts.lang, languages })}</div>` +
    `<div id="tip" role="tooltip" hidden></div>` +
    `<script type="application/json" id="stats-data">${inlineJson(data)}</script>` +
    `<script>${script}</script></body></html>`
  return { html, csp }
}
