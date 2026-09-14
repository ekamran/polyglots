import { describe, expect, it, vi } from 'vitest'
import { createRunControl } from '../src/run-control.js'

// Resolves to the gate's answer, or to 'waiting' if the gate is still holding.
// A pause is supposed to block, so "did not resolve" is the assertion.
async function settle(promise: Promise<string>): Promise<string> {
  return Promise.race([promise, new Promise<string>((r) => setTimeout(() => r('waiting'), 10))])
}

describe('createRunControl', () => {
  it('lets work through when nothing has asked it to stop', async () => {
    expect(await createRunControl().gate()).toBe('go')
  })

  it('holds at the gate once paused, and lets go on resume', async () => {
    const control = createRunControl()
    control.pause()
    const gate = control.gate()
    expect(await settle(gate)).toBe('waiting')

    control.resume()
    expect(await gate).toBe('go')
  })

  // Quitting while parked is the whole point: the user paused for quota, then
  // decided not to wait.
  it('releases a waiting gate with stop when asked to quit', async () => {
    const control = createRunControl()
    control.pause()
    const gate = control.gate()
    control.stop()
    expect(await gate).toBe('stop')
  })

  it('stops at the next boundary when asked while running', async () => {
    const control = createRunControl()
    control.stop()
    expect(await control.gate()).toBe('stop')
  })

  it('stays stopped once stopped', async () => {
    const control = createRunControl()
    control.stop()
    await control.gate()
    expect(await control.gate()).toBe('stop')
  })

  // Otherwise a stray keypress after q would park a run that is on its way out.
  it('ignores a pause once it is stopping', async () => {
    const control = createRunControl()
    control.stop()
    control.pause()
    expect(control.state).toBe('stopping')
    expect(await control.gate()).toBe('stop')
  })

  it('reports its state so a progress line can say so', () => {
    const control = createRunControl()
    expect(control.state).toBe('running')
    control.pause()
    expect(control.state).toBe('paused')
    control.resume()
    expect(control.state).toBe('running')
  })

  it('tells subscribers when the state changes, and only when it changes', () => {
    const control = createRunControl()
    const seen = vi.fn()
    control.subscribe(seen)

    control.pause()
    control.pause()
    control.resume()

    expect(seen.mock.calls.map(([s]) => s)).toEqual(['paused', 'running'])
  })

  it('stops notifying an unsubscribed listener', () => {
    const control = createRunControl()
    const seen = vi.fn()
    control.subscribe(seen)()
    control.pause()
    expect(seen).not.toHaveBeenCalled()
  })

  it('does nothing on a resume that was never paused', async () => {
    const control = createRunControl()
    control.resume()
    expect(control.state).toBe('running')
    expect(await control.gate()).toBe('go')
  })
})
