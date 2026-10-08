import { createHash } from "node:crypto";

interface CacheEntry {
  title: string;
  summary: string;
  characterCount: number;
  modelUsed: string;
  expiresAt: number;
}

// Global process-level cache (persists across warm serverless invocations)
const summaryCache = new Map<string, CacheEntry>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function getCacheKey(url: string, provider: string): string {
  return createHash("sha256").update(`${provider}:${url.trim()}`).digest("hex");
}

export function getCachedSummary(key: string): CacheEntry | null {
  const item = summaryCache.get(key);
  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    summaryCache.delete(key);
    return null;
  }
  return item;
}

export function setCachedSummary(
  key: string,
  data: Omit<CacheEntry, "expiresAt">,
  ttlSeconds = 3600 // 1 hour
): void {
  // Prune oldest entries if cache exceeds 500 records
  if (summaryCache.size > 500) {
    const oldestKey = summaryCache.keys().next().value;
    if (oldestKey) summaryCache.delete(oldestKey);
  }

  summaryCache.set(key, {
    ...data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

// In-Memory Rate Limiter (10 requests per minute per IP for non-BYOK users)
export function checkRateLimit(clientIp: string, limit = 10, windowMs = 60000): boolean {
  const now = Date.now();
  const current = rateLimitMap.get(clientIp);

  if (!current || now > current.resetAt) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  return true;
}