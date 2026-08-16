import { describe, expect, it } from 'vitest'
import { LifecycleNotifier } from '../src/lifecycle.ts'
import type { LifecyclePort } from '../src/lifecycle.ts'

/** A fake port recording sends. */
function createPort() {
  const sent: { chatId: string; text: string }[] = []
  const port: LifecyclePort = {
    send: async (chatId, message) => { sent.push({ chatId, text: message.text }) },
  }
  return { port, sent }
}

/** A notifier over a fake clock and empty activity. */
function createNotifier(options: {
  activity?: Record<string, number>
  now?: () => number
  enabled?: boolean
} = {}) {
  let clock = 0
  const now = options.now ?? (() => clock)
  const { port, sent } = createPort()
  const patches: object[] = []
  const reports: string[] = []
  const notifier = new LifecycleNotifier({
    enabled: options.enabled ?? true,
    activity: options.activity ?? {},
    persist: async (patch) => { patches.push(patch); return true },
    report: (line) => { reports.push(line) },
    port,
    now,
  })
  return { notifier, port, sent, patches, reports, tick: (ms: number) => { clock += ms } }
}

describe('LifecycleNotifier', () => {
  it('notifies persisted activity on interrupt and restore', async () => {
    const { notifier, sent } = createNotifier({ activity: { oc_a: 100, oc_b: 200 } })
    notifier.notifyInterrupted()
    await Promise.resolve()
    expect(sent.map(s => s.chatId).sort()).toEqual(['oc_a', 'oc_b'])
    expect(sent[0]!.text).toContain('服务连接中断')
    sent.length = 0
    notifier.notifyRestored()
    await Promise.resolve()
    expect(sent.map(s => s.chatId).sort()).toEqual(['oc_a', 'oc_b'])
    expect(sent[0]!.text).toContain('服务已恢复')
  })

  it('throttles repeat notices per chat within the window', async () => {
    const { notifier, sent, tick } = createNotifier({ activity: { oc_a: 100 } })
    notifier.notifyInterrupted()
    await Promise.resolve()
    expect(sent.length).toBe(1)
    tick(10_000) // still inside the 60s window
    notifier.notifyInterrupted()
    await Promise.resolve()
    expect(sent.length).toBe(1)
    tick(60_000) // window passed
    notifier.notifyInterrupted()
    await Promise.resolve()
    expect(sent.length).toBe(2)
  })

  it('records activity and persists it throttled', async () => {
    const { notifier, patches, tick } = createNotifier({ activity: {} })
    notifier.recordActivity('oc_c')
    await Promise.resolve()
    expect(patches.length).toBe(1)
    expect(patches[0]).toEqual({ chatActivity: { oc_c: 0 } })
    tick(60_000)
    notifier.recordActivity('oc_c')
    await Promise.resolve()
    expect(patches.length).toBe(1) // throttled: 60s < 5min
    tick(5 * 60 * 1000)
    notifier.recordActivity('oc_c')
    await Promise.resolve()
    expect(patches.length).toBe(2)
  })

  it('includes fresh (in-memory) chats in the audience', async () => {
    const { notifier, sent } = createNotifier({ activity: {} })
    notifier.recordActivity('oc_new')
    notifier.notifyRestored()
    await Promise.resolve()
    expect(sent.map(s => s.chatId)).toEqual(['oc_new'])
  })

  it('does nothing when disabled', async () => {
    const { notifier, sent } = createNotifier({ activity: { oc_a: 1 }, enabled: false })
    notifier.recordActivity('oc_b')
    notifier.notifyInterrupted()
    notifier.notifyRestored()
    await Promise.resolve()
    expect(sent.length).toBe(0)
  })
})
