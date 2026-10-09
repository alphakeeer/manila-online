import type { GameService } from './service.js'

export interface SeatAutopilotOptions {
  /** How long the seat that must act may stay disconnected before the bot steps in. */
  awayAfterMs: number
  /** Pause before each bot move so other players can follow it. */
  thinkMs: number
  now?: () => number
}

type Pending = { timer: NodeJS.Timeout; revision: number; kind: 'act' | 'away' }

/**
 * Schedules server-side takeover moves. State lives in the database (room_members.autopilot)
 * and every move goes through GameService's normal transaction; this class only owns timers,
 * so a restart loses nothing but a pending delay (the periodic sweep re-arms it).
 */
export class SeatAutopilot {
  private readonly pending = new Map<string, Pending>()
  private readonly running = new Set<string>()
  /** Revision at which the bot found no legal move; wait for the state to change instead of spinning. */
  private readonly stuck = new Map<string, number>()
  private stopped = false
  private readonly inflight = new Set<Promise<void>>()

  constructor(
    private readonly game: GameService,
    private readonly presence: { offlineSince(roomCode: string, seat: number): number | null },
    private readonly publish: (roomCode: string) => Promise<void>,
    private readonly options: SeatAutopilotOptions,
    private readonly onError: (roomCode: string, error: unknown) => void = () => undefined,
  ) {}

  private get now() { return this.options.now?.() ?? Date.now() }

  /** Re-evaluates one room; cheap and idempotent, safe to call on every change. */
  check(roomCode: string): Promise<void> {
    if (this.stopped || this.running.has(roomCode)) return Promise.resolve()
    const evaluation = this.evaluate(roomCode)
    this.inflight.add(evaluation)
    void evaluation.finally(() => this.inflight.delete(evaluation))
    return evaluation
  }

  private async evaluate(roomCode: string): Promise<void> {
    try {
      const state = await this.game.autopilotState(roomCode)
      if (this.stopped) return
      const actor = state?.actor
      if (!state || !actor) return this.cancel(roomCode)
      if (this.stuck.get(roomCode) === state.revision) return
      this.stuck.delete(roomCode)
      let kind: Pending['kind']
      let delay: number
      if (actor.autopilot || !actor.sessionValid) {
        kind = 'act'
        delay = this.options.thinkMs
      } else {
        const since = this.presence.offlineSince(roomCode, actor.seat)
        if (since === null) return this.cancel(roomCode)
        kind = 'away'
        delay = Math.max(this.options.thinkMs, since + this.options.awayAfterMs - this.now)
      }
      const existing = this.pending.get(roomCode)
      if (existing && existing.revision === state.revision && existing.kind === kind) return
      this.cancel(roomCode)
      const timer = setTimeout(() => {
        const move = this.fire(roomCode, state.revision)
        this.inflight.add(move)
        void move.finally(() => this.inflight.delete(move))
      }, delay)
      timer.unref?.()
      this.pending.set(roomCode, { timer, revision: state.revision, kind })
    } catch (error) {
      this.onError(roomCode, error)
    }
  }

  async sweep(): Promise<void> {
    try {
      for (const code of await this.game.playingRoomCodes()) await this.check(code)
    } catch (error) {
      this.onError('*', error)
    }
  }

  /** Cancels timers and waits for a move already in its transaction, so shutdown never races the pool. */
  async stop() {
    this.stopped = true
    for (const code of [...this.pending.keys()]) this.cancel(code)
    await Promise.allSettled([...this.inflight])
  }

  private cancel(roomCode: string) {
    const existing = this.pending.get(roomCode)
    if (existing) clearTimeout(existing.timer)
    this.pending.delete(roomCode)
  }

  private async fire(roomCode: string, revision: number) {
    this.pending.delete(roomCode)
    if (this.stopped) return
    this.running.add(roomCode)
    try {
      const result = await this.game.autopilotAct(roomCode, revision)
      if (result.kind === 'stuck') {
        this.stuck.set(roomCode, revision)
        this.onError(roomCode, new Error('autopilot found no legal move'))
      }
      if (result.kind === 'accepted') await this.publish(roomCode)
    } catch (error) {
      this.onError(roomCode, error)
    } finally {
      this.running.delete(roomCode)
    }
    // publish() already re-checks, but a skipped/stuck move must re-arm too.
    if (!this.stopped) await this.check(roomCode)
  }
}
