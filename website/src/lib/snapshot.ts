// What scripts/snapshot.ts rendered from app/src. Written before every dev and
// build; see that script for how and why.
import data from '../generated/snapshot.json';

export interface Frame {
  hold: number;
  html: string[];
}

export interface Demo {
  command: string;
  frames: Frame[];
  final: string[];
  text: string;
}

export interface HelpEntry {
  path: string[];
  text: string;
}

/** A recording of the full-screen app: every frame is the whole terminal. */
export interface TuiDemo {
  columns: number;
  rows: number;
  frames: Frame[];
  /** The still, the first frame, as plain text. */
  text: string;
}

interface Snapshot {
  version: string;
  wordmark: string[] | null;
  demos: Record<'review' | 'translate' | 'fetch' | 'stats', Demo>;
  tui: Record<'review' | 'setup', TuiDemo>;
  help: HelpEntry[];
}

export const snapshot = data as unknown as Snapshot;
export const demos = snapshot.demos;
export const tuiDemos = snapshot.tui;
