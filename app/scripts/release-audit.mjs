// The release's audit gate: why a report from npm audit stops a release.
//
// Kept apart from release.mjs, as cutRelease is, so the decision can be
// tested without running npm. release.mjs runs
// `npm audit --omit=dev --audit-level=high --json` and hands the output here.
// The exit code alone is not used: npm exits non-zero both for a finding and
// for an audit it could not run, and those need different sentences.
//
// High and critical stop it; moderate and low do not, which is the bar the
// release checklist set (#9). Dev dependencies are left out because none of
// them is installed for a user, and a finding in a test runner is a reason to
// upgrade it, not to hold back a release.
//
// Fails closed. A release that could not ask the registry has not passed the
// check, so being offline stops it with that said, rather than letting the
// one release nobody audited through.

const STOPS = new Set(['high', 'critical'])

/** The sentence that stops a release, or undefined when the report is clean enough. */
export function auditRefusal(json) {
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    return 'npm audit could not run: its output was not a report'
  }
  if (parsed?.error) {
    return `npm audit could not run: ${parsed.error.summary ?? parsed.error.code ?? 'no reason given'}`
  }
  if (!parsed || typeof parsed.vulnerabilities !== 'object' || parsed.vulnerabilities === null) {
    return 'npm audit could not run: the report has no vulnerabilities section'
  }
  const found = Object.values(parsed.vulnerabilities)
    .filter((v) => STOPS.has(v?.severity))
    .map((v) => `${v.name} (${v.severity})`)
    .sort()
  if (found.length === 0) return undefined
  const what = found.length === 1 ? '1 production dependency has' : `${found.length} production dependencies have`
  return `${what} a high or critical advisory: ${found.join(', ')}. Run npm audit --omit=dev for the details; upgrade, override, or record why it does not apply.`
}
