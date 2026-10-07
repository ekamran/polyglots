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

interface Snapshot {
  version: string;
  wordmark: string[] | null;
  demos: Record<'review' | 'translate' | 'fetch' | 'stats', Demo>;
  help: HelpEntry[];
}

export const snapshot = data as unknown as Snapshot;
export const demos = snapshot.demos;
