import { describe, expect, it } from 'vitest'
import { auditRefusal } from '../../scripts/release-audit.mjs'

// The shape npm audit --json writes (auditReportVersion 2), cut to the fields
// read. --audit-level only sets the exit code; the report lists everything.
function report(vulnerabilities: Record<string, { severity: string; via?: unknown[] }>) {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(
      Object.entries(vulnerabilities).map(([name, v]) => [name, { name, via: [], ...v }]),
    ),
    metadata: { vulnerabilities: {} },
  })
}

describe('auditRefusal', () => {
  it('lets a clean report through', () => {
    expect(auditRefusal(report({}))).toBeUndefined()
  })

  // Below high is recorded, not a reason to stop: the issue's own bar.
  it('lets moderate and low findings through', () => {
    expect(auditRefusal(report({ 'fast-uri': { severity: 'moderate' }, foo: { severity: 'low' } }))).toBeUndefined()
  })

  it('refuses on a high or critical finding, naming each package and its severity', () => {
    const refusal = auditRefusal(
      report({
        'adm-zip': { severity: 'high' },
        'proxy-addr': { severity: 'critical' },
        'fast-uri': { severity: 'moderate' },
      }),
    )
    expect(refusal).toMatch(/2 production dependencies/)
    expect(refusal).toContain('adm-zip (high)')
    expect(refusal).toContain('proxy-addr (critical)')
    expect(refusal).not.toContain('fast-uri')
    expect(refusal).toContain('npm audit --omit=dev')
  })

  // A release that could not ask is not a release that passed. Offline, or
  // with the registry down, the person releasing is told rather than waved on.
  it('refuses when npm could not produce a report', () => {
    expect(auditRefusal(JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request to registry failed' } }))).toMatch(
      /could not run.*request to registry failed/,
    )
    expect(auditRefusal('not json')).toMatch(/could not run/)
    expect(auditRefusal(JSON.stringify({ auditReportVersion: 2 }))).toMatch(/could not run/)
  })
})
