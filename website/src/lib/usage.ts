// The all-time totals that opted-in installs report (docs/usage-statistics.md),
// read when the site is built and again by the home page in the browser. The
// usage endpoint writes them outside the site's folder on the server, because
// deploy.sh syncs that folder with --delete, and serves them at the address
// below.
//
// Optional in every way: the endpoint may not be deployed, may be down, or may
// have nothing yet, and none of that is a reason to fail a build or to print a
// zero on the home page. Any doubt about the file and the page leaves the line
// out. The numbers can also go down between builds, when someone deletes their
// run history and reports smaller totals, so the page never says "growing".

export const USAGE_TOTALS_URL = 'https://ada.tools/polyglots/api/usage/totals.json';
const TIMEOUT_MS = 5000;

export interface UsageTotals {
  installs: number;
  reviewed: number;
  drafted: number;
  repaired: number;
}

// The page is built in Node, but the site's TypeScript has no Node types, so
// the two Node things used here are reached without them.
const buildEnv = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const FS = 'node:fs/promises';
const readText = async (path: string): Promise<string> =>
  ((await import(/* @vite-ignore */ FS)) as { readFile(path: string, encoding: 'utf8'): Promise<string> }).readFile(path, 'utf8');

/**
 * A total as the page says it: rounded down to two significant figures. The
 * totals cannot be verified, since nothing identifies who reports them, so the
 * page gives an approximate figure that never claims more than was reported.
 */
export function approx(v: number): string {
  if (v < 100) return v.toLocaleString('en-US');
  const step = 10 ** (Math.floor(Math.log10(v)) - 1);
  return (Math.floor(v / step) * step).toLocaleString('en-US');
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The totals the page shows, or undefined when the file is not what it should be. */
export function parseUsageTotals(raw: unknown): UsageTotals | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const { installs, reviewed, drafted, repaired } = raw as Record<string, unknown>;
  if (!count(installs) || !count(reviewed) || !count(drafted) || !count(repaired)) return undefined;
  if (installs === 0) return undefined;
  return { installs, reviewed, drafted, repaired };
}

/**
 * Reads the totals from POLYGLOTS_USAGE_TOTALS (an http(s) address or a local
 * file, for previewing the line) or from the endpoint. Never throws.
 */
export async function loadUsageTotals(env: Record<string, string | undefined> = buildEnv()): Promise<UsageTotals | undefined> {
  const source = env.POLYGLOTS_USAGE_TOTALS || USAGE_TOTALS_URL;
  try {
    if (!/^https?:\/\//i.test(source)) return parseUsageTotals(JSON.parse(await readText(source)));
    const response = await fetch(source, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!response.ok) return undefined;
    return parseUsageTotals(await response.json());
  } catch {
    return undefined;
  }
}
