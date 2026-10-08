// Types for release-audit.mjs, so its test is checked like the rest. The
// script stays plain ESM because release.mjs runs it with bare node, no tsx.
export function auditRefusal(json: string): string | undefined
