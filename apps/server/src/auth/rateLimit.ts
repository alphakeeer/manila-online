export interface Clock {
  now(): number
}

interface Counter {
  windowStartedAt: number
  count: number
}

/** A deliberately local guard: persistence remains authoritative and no request is ever allowed by it alone. */
export class FixedWindowRateLimiter {
  private readonly counters = new Map<string, Counter>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock = Date,
  ) {}

  consume(key: string) {
    const now = this.clock.now()
    const previous = this.counters.get(key)
    if (!previous || now - previous.windowStartedAt >= this.windowMs) {
      this.counters.set(key, { windowStartedAt: now, count: 1 })
      return true
    }
    if (previous.count >= this.limit) return false
    previous.count += 1
    return true
  }
}
