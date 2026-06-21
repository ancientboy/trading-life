/** 防止同一 key 的 async 请求并发叠加（浏览器 ERR_INSUFFICIENT_RESOURCES） */
const inflight = new Map<string, Promise<unknown>>();

export function dedupeAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

const lastRun = new Map<string, number>();

/** 距上次成功发起至少 minGapMs 才再执行，否则跳过或复用 in-flight */
export function throttleAsync<T>(
  key: string,
  minGapMs: number,
  fn: () => Promise<T>,
): Promise<T | void> {
  const now = Date.now();
  const prev = lastRun.get(key) ?? 0;
  if (now - prev < minGapMs) {
    const existing = inflight.get(key);
    return existing ? (existing as Promise<T>) : Promise.resolve();
  }
  lastRun.set(key, now);
  return dedupeAsync(key, fn);
}
