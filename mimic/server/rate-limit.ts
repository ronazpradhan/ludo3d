/** Sliding-window counter: at most `limit` hits per `windowMs` for each key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit; false means the key is over its limit and the action should be refused. */
  take(key: string, now: number = Date.now()): boolean {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter(t => t > since);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  forget(key: string): void {
    this.hits.delete(key);
  }

  /** Drops keys with no recent hits so the map doesn't grow forever. */
  prune(now: number = Date.now()): void {
    const since = now - this.windowMs;
    for (const [k, list] of this.hits) if (!list.some(t => t > since)) this.hits.delete(k);
  }
}
