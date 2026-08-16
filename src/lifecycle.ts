/**
 * Lifecycle notifications (enterprise fork): tell every recently active chat
 * when the long connection drops and when it recovers, so nobody waits on a
 * silent bot. Two triggers:
 *
 * - `reconnecting`: the transport lost its connection — chats are told the
 *   service is interrupted and that messages may be lost;
 * - `reconnected`: the transport recovered (including right after a process
 *   restart, when the first connection lands) — chats are told the service is
 *   back.
 *
 * A process exit (system restart / SIGTERM) races the HTTP send, so the
 * interrupt notice on dispose is best-effort: fire-and-forget, and the
 * post-restart `reconnected` notice is the reliable half of the pair.
 *
 * The audience is a settings-persisted activity map (chatId → last active
 * epoch ms, written throttled), so a restarted process still knows which chats
 * to tell. Both notice kinds are throttled per chat to keep flapping networks
 * from spamming.
 * @module dsh-lark-enterprise/lifecycle
 */

/** Persisted activity map: chatId → last-active epoch ms. */
export type ChatActivity = Record<string, number>

/** How often one chat's activity stamp is persisted. */
const ACTIVITY_WRITE_MIN_MS = 5 * 60 * 1000

/** How long one notice kind stays throttled per chat. */
const NOTICE_THROTTLE_MS = 60 * 1000

/** The sending surface this module needs from the bridge. */
export interface LifecyclePort {
  /** Send one message to one chat. Errors are contained by the caller. */
  send(chatId: string, message: { text: string }): Promise<unknown>
}

/** Construction options for {@link LifecycleNotifier}. */
export interface LifecycleOptions {
  /** Whether lifecycle notices are enabled at all. */
  readonly enabled: boolean
  /** Persisted activity map (from settings); mutated in place and flushed via {@link persist}. */
  readonly activity: ChatActivity
  /** Deep-merge one patch into the plugin's settings section; false = not composed. */
  readonly persist?: ((patch: { chatActivity: ChatActivity }) => Promise<boolean>) | undefined
  /** Operator console line. */
  readonly report?: ((line: string) => void) | undefined
  /** Send surface. */
  readonly port: LifecyclePort
  /** Clock for tests. */
  readonly now?: (() => number) | undefined
}

/**
 * Tracks recently active chats and emits the two lifecycle notices, throttled
 * per kind per chat.
 */
export class LifecycleNotifier {
  private readonly enabled: boolean
  private readonly activity: ChatActivity
  private readonly persist: (patch: { chatActivity: ChatActivity }) => Promise<boolean>
  private readonly report: (line: string) => void
  private readonly port: LifecyclePort
  private readonly now: () => number
  /** chatId → last epoch ms this chat was stamped to disk. */
  private readonly lastWrite = new Map<string, number>()
  /** chatId → last epoch ms an interrupt notice was sent. */
  private readonly lastInterrupt = new Map<string, number>()
  /** chatId → last epoch ms a restore notice was sent. */
  private readonly lastRestore = new Map<string, number>()
  /** In-memory chats not yet persisted (fresh process before any write). */
  private readonly fresh = new Set<string>()

  constructor(options: LifecycleOptions) {
    this.enabled = options.enabled
    this.activity = options.activity
    this.persist = options.persist ?? (async () => false)
    this.report = options.report ?? (() => {})
    this.port = options.port
    this.now = options.now ?? Date.now
  }

  /** The chat ids to notify: persisted activity plus anything fresh this run. */
  private audience(): string[] {
    const ids = new Set([...Object.keys(this.activity), ...this.fresh])
    return [...ids]
  }

  /** Record one chat's activity, persisted throttled. */
  recordActivity(chatId: string): void {
    if (!this.enabled) return
    this.fresh.add(chatId)
    const last = this.lastWrite.get(chatId)
    const now = this.now()
    if (last !== undefined && now - last < ACTIVITY_WRITE_MIN_MS) return
    this.lastWrite.set(chatId, now)
    this.activity[chatId] = now
    void this.persist({ chatActivity: { [chatId]: now } }).catch((error: unknown) => {
      this.report(`lark-channel: persisting chat activity failed: ${String(error)}`)
    })
  }

  /** Tell every active chat the service is interrupted (best-effort). */
  notifyInterrupted(): void {
    if (!this.enabled) return
    const now = this.now()
    const message = {
      text: '⚠️ 服务连接中断，正在自动重连。期间消息可能延迟或丢失，恢复后我会通知你。',
    }
    for (const chatId of this.audience()) {
      const last = this.lastInterrupt.get(chatId)
      if (last !== undefined && now - last < NOTICE_THROTTLE_MS) continue
      this.lastInterrupt.set(chatId, now)
      void this.port.send(chatId, message).catch((error: unknown) => {
        this.report(`lark-channel: interrupt notice to ${chatId} failed: ${String(error)}`)
      })
    }
  }

  /** Tell every active chat the service recovered. */
  notifyRestored(): void {
    if (!this.enabled) return
    const now = this.now()
    const message = {
      text: '✅ 服务已恢复连接。之前发送的消息如有遗漏，请重新发送。',
    }
    for (const chatId of this.audience()) {
      const last = this.lastRestore.get(chatId)
      if (last !== undefined && now - last < NOTICE_THROTTLE_MS) continue
      this.lastRestore.set(chatId, now)
      void this.port.send(chatId, message).catch((error: unknown) => {
        this.report(`lark-channel: restore notice to ${chatId} failed: ${String(error)}`)
      })
    }
  }
}
