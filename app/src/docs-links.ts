// The website's documentation pages. A message that tells someone to read
// more must name a place an installed copy can reach, and a docs/ path only
// exists in a checkout of the repo.
const DOCS_BASE = 'https://ada.tools/polyglots/docs'

export const docsUrl = (page: 'antigravity' | 'local-models'): string => `${DOCS_BASE}/${page}/`
