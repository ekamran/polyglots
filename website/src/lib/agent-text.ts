import { getEntry } from 'astro:content';
import { siteHref } from './markdown.mjs';
import { snapshot } from './snapshot';
import { AGENTS } from './docs';

export const SITE = 'https://ada.tools';

/** A docs-relative markdown link made absolute, for text read outside the site. */
const absolute = (href: string) => {
  const next = siteHref(href);
  return next ? (next.startsWith('/') ? `${SITE}${next}` : next) : href;
};

export async function agentsMarkdown(): Promise<string> {
  const entry = await getEntry('docs', AGENTS);
  if (!entry?.body) throw new Error('docs/agents.md is missing; /ai and /ai.txt are built from it');
  return entry.body.replace(/\]\(([^)\s]+)\)/g, (_, href: string) => `](${absolute(href)})`);
}

/** The runbook followed by the whole command reference, which is what an agent fetching plain text needs. */
export async function agentsText(): Promise<string> {
  const reference = snapshot.help
    .map((h) => `### polyglots ${h.path.join(' ')}`.trimEnd() + '\n\n```\n' + h.text + '\n```')
    .join('\n\n');
  return `${(await agentsMarkdown()).trimEnd()}\n\n## Command reference\n\nGenerated from polyglots ${snapshot.version} --help.\n\n${reference}\n`;
}
