/**
 * Fixed-window in-memory limiter. Handlers depend only on the `RateLimiter` interface; swap
 * `MemoryRateLimiter` for a Redis-backed implementation (REDIS_URL) in multi-instance deployments.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterSec: number };
  /** Has this key already used up its allowance? (does not count) */
  peek?(key: string, limit: number): boolean;
  /** Forget all counters (tests). */
  reset?(): void;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  reset() { this.buckets.clear(); }
  peek(key: string, limit: number) {
    const b = this.buckets.get(key);
    return !!b && b.resetAt > Date.now() && b.count >= limit;
  }
  hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
      if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    }
    b.count++;
    return {
      allowed: b.count <= limit,
      remaining: Math.max(0, limit - b.count),
      retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
    };
  }
}

const g = globalThis as unknown as { __limiter?: RateLimiter };
export const rateLimiter: RateLimiter = (g.__limiter ??= new MemoryRateLimiter());
