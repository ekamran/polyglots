// The website and its documentation pages. A message that tells someone to
// read more must name a place an installed copy can reach, and a docs/ path
// only exists in a checkout of the repo.
export const SITE_URL = 'https://ada.tools/polyglots/'
const DOCS_BASE = `${SITE_URL}docs`

export const docsUrl = (page: 'antigravity' | 'local-models'): string => `${DOCS_BASE}/${page}/`
