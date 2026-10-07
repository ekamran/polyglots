// @ts-check
import { defineConfig } from 'astro/config';
import { rehypeDocLinks } from './src/lib/rehype-doc-links.mjs';

export default defineConfig({
  site: 'https://ada.tools',
  base: '/polyglots',
  // Directory output, so /polyglots/ai is answered by ai/index.html. LiteSpeed
  // on ada.tools redirects the bare path to the slashed one (checked against
  // /sitcom-flavour/og), which is the only way to serve an extensionless URL
  // without server config.
  build: { format: 'directory' },
  trailingSlash: 'ignore',
  markdown: {
    // The docs are shell, YAML and JSON. Plain monospace blocks match the
    // terminal panels and need no second palette per theme; a highlighter would
    // ship two sets of inline colours for little gain.
    syntaxHighlight: false,
    rehypePlugins: [rehypeDocLinks],
  },
  vite: {
    // The snapshot step and the docs collection read ../app/src and ../docs.
    server: { fs: { allow: ['..'] } },
  },
});
