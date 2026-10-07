// The docs are written to read on GitHub, so they link to each other as
// sibling files (`review.md#batches`) and to the code by repo path. On the site
// those become page URLs. Doing it here rather than writing site URLs into the
// markdown keeps both readings working from one source.

const BASE = '/polyglots';
const REPO = 'https://github.com/emreerkan/polyglots/blob/main/';

/** Where a docs-relative href points on the site, or undefined to leave it. */
export function siteHref(href) {
  if (/^([a-z]+:|#|\/)/i.test(href)) return undefined;
  const [path, hash = ''] = href.split('#');
  const anchor = hash ? `#${hash}` : '';
  const sibling = /^(?:\.\/)?([a-z0-9-]+)\.md$/i.exec(path);
  if (sibling) {
    const slug = sibling[1].toLowerCase();
    // agents.md is published as the agent page, not as a doc.
    return slug === 'agents' ? `${BASE}/ai/${anchor}` : `${BASE}/docs/${slug}/${anchor}`;
  }
  // Anything else relative climbs out of docs/ into the repo.
  const repoPath = path.replace(/^(\.\.\/)+/, '');
  return `${REPO}${repoPath}${anchor}`;
}

export function rehypeDocLinks() {
  const visit = (node) => {
    if (node.type === 'element' && node.tagName === 'a' && typeof node.properties?.href === 'string') {
      const next = siteHref(node.properties.href);
      if (next) node.properties.href = next;
    }
    for (const child of node.children ?? []) visit(child);
  };
  return (tree) => visit(tree);
}
