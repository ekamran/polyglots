// Types for release-changelog.mjs, so its test is checked like the rest. The
// script stays plain ESM because release.mjs runs it with bare node, no tsx.
export function cutRelease(text: string, version: string, date: string): { changelog: string; notes: string }
