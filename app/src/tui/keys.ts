import type { ScreenId } from './menu.js'

// The one table of keys. The footer, the `?` overlay and the help page all
// read it, so a screen's keys are written down once. The screens still bind
// their own keys, as they did before this table existed, so a binding moved
// without its line here leaves the footer wrong; moving each screen onto a
// hook that binds from this table is the follow-up that would close that.

export interface KeyHelp {
  keys: string
  does: string
}

// The same key does the same thing everywhere. q is "leave": back one level
// on every screen, quit on home, and stop on a run, which is the CLI's q too.
export const GLOBAL_KEYS: KeyHelp[] = [
  { keys: '?', does: 'help for this screen' },
  { keys: 'ctrl+k  :', does: 'go to any screen' },
  { keys: 'esc', does: 'back' },
  { keys: 'q', does: 'back; quits from home; stops a run' },
  { keys: 'ctrl+c', does: 'quit, asking first while a run is going' },
  { keys: 'x', does: 'stop the stats server while it serves' },
]

export const RUN_KEYS: KeyHelp[] = [
  { keys: 'p', does: 'pause after the current batch' },
  { keys: 'r', does: 'resume' },
  { keys: 'q', does: 'stop after the current batch' },
]

const MENU_KEYS: KeyHelp[] = [
  { keys: '←↑↓→', does: 'move' },
  { keys: 'enter', does: 'open' },
  { keys: 'letter', does: 'open the card with that key' },
]

const FORM_KEYS: KeyHelp[] = [
  { keys: '↑↓  tab', does: 'move between fields' },
  { keys: '←→  space', does: 'change a choice' },
  { keys: 'enter', does: 'start' },
]

export const SCREEN_KEYS: Record<ScreenId, KeyHelp[]> = {
  home: [...MENU_KEYS, { keys: 'tab', does: 'setup status' }, { keys: 'p', does: 'switch review provider' }],
  tools: MENU_KEYS,
  config: MENU_KEYS,
  translate: [...FORM_KEYS, ...RUN_KEYS, { keys: 'o', does: 'open the result' }],
  review: [...FORM_KEYS, ...RUN_KEYS, { keys: 'o', does: 'open the problems file' }, { keys: 'c', does: 'copy the report' }],
  fetch: [{ keys: 'enter', does: 'add a project; on an empty line, continue' }, { keys: 'ctrl+d', does: 'continue' }, ...RUN_KEYS],
  stats: [
    { keys: 'o', does: 'open the page in a browser' },
    { keys: 'w', does: 'write a standalone HTML copy' },
    { keys: 'x', does: 'stop serving the page' },
  ],
  help: [{ keys: '↑↓', does: 'scroll' }],
  about: [],
  split: [{ keys: 'enter', does: 'pick and split' }],
  'import-tm': [{ keys: 'space', does: 'mark a file' }, { keys: 'enter', does: 'import' }],
  'export-tm': [...FORM_KEYS],
  'sync-glossary': [{ keys: 'enter', does: 'sync' }],
  'locale-rules': [{ keys: '↑↓', does: 'move' }, { keys: 'enter', does: 'open a section' }],
  agents: [{ keys: 'r', does: 're-check' }],
  'local-models': [{ keys: 'r', does: 're-check' }, { keys: 'enter', does: 'choose' }],
  'configure-keys': [{ keys: 'enter', does: 'save and go to the next key' }],
  setup: [{ keys: 'enter', does: 'choose and continue' }, { keys: 'esc', does: 'skip this step' }],
  interface: [{ keys: '↑↓', does: 'move' }, { keys: 'space  enter', does: 'toggle' }],
}

// What the footer has room for: the screen's first few keys, then the
// globals that matter most. The `?` overlay has the rest.
export function footerKeys(screen: ScreenId, serving = false): KeyHelp[] {
  // While the stats server runs, x stops it from any screen; the stats screen
  // lists x among its own keys already.
  const stats = serving && screen !== 'stats' ? [{ keys: 'x', does: 'stop stats' }] : []
  if (screen === 'home') {
    return [
      ...stats,
      { keys: '←↑↓→', does: 'move' },
      { keys: 'enter', does: 'open' },
      { keys: 'tab', does: 'setup' },
      { keys: 'p', does: 'provider' },
      { keys: '?', does: 'help' },
      { keys: '^K', does: 'go to' },
      { keys: 'q', does: 'quit' },
    ]
  }
  const own = SCREEN_KEYS[screen].slice(0, 3)
  return [...stats, ...own, { keys: '?', does: 'help' }, ...(own.some((k) => k.keys === 'esc') ? [] : [{ keys: 'esc', does: 'back' }])]
}
