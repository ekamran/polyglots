import { describe, expect, it, vi } from 'vitest'
import { closeServices, createServices } from '../../src/tui/services.js'

const handle = (close = vi.fn(async () => {})) => ({ url: 'http://127.0.0.1:9/x/', port: 9, close })

describe('closeServices', () => {
  it('reports a close that finished', async () => {
    const services = createServices()
    const h = handle()
    await services.startStats(async () => h)
    await expect(closeServices(services, 50)).resolves.toBe('closed')
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  // The caller has to know, because a listening socket keeps Node alive
  // after the terminal is restored and the CLI only sets an exit code.
  it('reports a close that hung, instead of waiting on it', async () => {
    const services = createServices()
    await services.startStats(async () => handle(vi.fn(() => new Promise<void>(() => {}))))
    await expect(closeServices(services, 20)).resolves.toBe('timeout')
  })

  it('closes a server whose start finishes after the app has shut down', async () => {
    const services = createServices()
    let finish!: (h: ReturnType<typeof handle>) => void
    const starting = services.startStats(() => new Promise((resolve) => (finish = resolve)))
    starting.catch(() => {})
    await expect(closeServices(services, 20)).resolves.toBe('timeout')
    const late = handle()
    finish(late)
    await expect(starting).rejects.toThrow(/closing/)
    expect(late.close).toHaveBeenCalledTimes(1)
    expect(services.stats).toBeUndefined()
  })

  // Shutdown waits for a start in flight; if that start lands and its close
  // then hangs, the wait must still end in a timeout the caller acts on.
  it('reports a timeout when a late-arriving server hangs on close', async () => {
    const services = createServices()
    let finish!: (h: ReturnType<typeof handle>) => void
    const starting = services.startStats(() => new Promise((resolve) => (finish = resolve)))
    starting.catch(() => {})
    const closing = closeServices(services, 50)
    const late = handle(vi.fn(() => new Promise<void>(() => {})))
    finish(late)
    await expect(closing).resolves.toBe('timeout')
    expect(late.close).toHaveBeenCalledTimes(1)
  })

  it('holds server errors for the footer, and clears them on stop', async () => {
    const services = createServices()
    await services.startStats(async () => handle())
    const seen = vi.fn()
    services.subscribe(seen)
    services.reportStatsError('EPIPE')
    expect(services.statsError).toBe('EPIPE')
    expect(seen).toHaveBeenCalled()
    await services.stopStats()
    expect(services.statsError).toBeUndefined()
  })
})
