// Per-minute rolling rate limiter (identical to nostr-ops-mcp's). Single bucket
// "events" since we only publish kinds 30017/30018/30019/30402.

const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly limits: Map<string, number>;

  constructor(limits: Record<string, number>) {
    this.limits = new Map(Object.entries(limits));
  }

  take(bucket: string): { ok: true } | { ok: false; reason: string } {
    const limit = this.limits.get(bucket);
    if (limit === undefined) return { ok: true };
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const entries = (this.buckets.get(bucket) ?? []).filter((ts) => ts > cutoff);
    if (entries.length >= limit) {
      return {
        ok: false,
        reason: `rate limit hit on "${bucket}": ${entries.length}/${limit} in the last 60s`,
      };
    }
    entries.push(now);
    this.buckets.set(bucket, entries);
    return { ok: true };
  }

  snapshot(): Record<string, { used: number; limit: number }> {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const out: Record<string, { used: number; limit: number }> = {};
    for (const [bucket, limit] of this.limits) {
      const entries = (this.buckets.get(bucket) ?? []).filter((ts) => ts > cutoff);
      out[bucket] = { used: entries.length, limit };
    }
    return out;
  }
}
