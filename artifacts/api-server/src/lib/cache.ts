type Entry<V> = { v: V; expiresAt: number };

export class TTLCache<K, V> {
  private map = new Map<K, Entry<V>>();
  constructor(
    private opts: { max: number; ttlMs: number },
  ) {}

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  set(key: K, v: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { v, expiresAt: Date.now() + this.opts.ttlMs });
    if (this.map.size > this.opts.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  invalidate(predicate?: (k: K) => boolean): void {
    if (!predicate) {
      this.map.clear();
      return;
    }
    for (const k of [...this.map.keys()]) {
      if (predicate(k)) this.map.delete(k);
    }
  }

  async wrap<T extends V>(key: K, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached as T;
    const v = await loader();
    this.set(key, v);
    return v;
  }
}

export const leaderboardCache = new TTLCache<string, unknown>({
  max: 200,
  ttlMs: 30_000,
});
export const platformStatsCache = new TTLCache<string, unknown>({
  max: 5,
  ttlMs: 30_000,
});
export const capabilitiesCache = new TTLCache<string, unknown>({
  max: 5,
  ttlMs: 5 * 60_000,
});

export function invalidateAggregateCaches(): void {
  leaderboardCache.invalidate();
  platformStatsCache.invalidate();
}
