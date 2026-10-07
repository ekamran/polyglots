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

// Sätteri mdast plugins (Astro 7's markdown processor).

export const docLinks = {
  name: 'polyglots-doc-links',
  link(node, ctx) {
    const next = siteHref(node.url);
    if (next) ctx.setProperty(node, 'url', next);
  },
};

// The pages print each doc's title in their own header, from the same heading
// (lib/docs.ts), so the body's copy goes. A factory, so "first" is per
// document rather than per build.
export const dropTitle = () => {
  let dropped = false;
  return {
    name: 'polyglots-drop-title',
    heading(node, ctx) {
      if (dropped || node.depth !== 1) return;
      dropped = true;
      ctx.removeNode(node);
    },
  };
};
