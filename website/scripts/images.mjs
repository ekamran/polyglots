// Renders public/og.png from the /og/ page and public/apple-touch-icon.png from
// the favicon, with a local Chrome. Run by hand after `npm run build`, when the
// card or the monogram changes; both outputs are committed.
//
//   npm run build && npm run images
//
// CHROME_PATH overrides where Chrome is.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
// astro preview runs as a background server in Astro 7, and says where, even
// when one was already running. Read the URL from what it prints, and stop it
// afterwards: killing the npx process leaves the server behind.
const server = spawn('npx', ['astro', 'preview', '--port', '4329'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let printed = '';
const origin = await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => {
    printed += String(chunk);
    const url = /http:\/\/localhost:\d+/.exec(printed);
    if (url) resolve(url[0]);
  });
  server.on('exit', (code) => (code ? reject(new Error(`astro preview exited ${code}`)) : undefined));
});
const stop = () => spawn('npx', ['astro', 'preview', 'stop'], { cwd: root, stdio: 'ignore' });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto(`${origin}/polyglots/og/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out('og.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });

  // iOS rounds the corners itself and ignores transparency, so the tile is
  // drawn full bleed, in the light scheme.
  const svg = readFileSync(out('favicon.svg'), 'utf8').replace('rx="14"', 'rx="0"');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setViewport({ width: 180, height: 180, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{width:180px;height:180px;display:block}</style>${svg}`);
  await page.screenshot({ path: out('apple-touch-icon.png'), clip: { x: 0, y: 0, width: 180, height: 180 } });
  console.log('Wrote public/og.png and public/apple-touch-icon.png');
} finally {
  await browser.close();
  stop();
}
