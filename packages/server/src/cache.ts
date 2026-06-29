/**
 * Önbellek + kota soyutlaması — DESIGN.md §7 (maliyet) / §9.2 (kota).
 * InMemory* → geliştirme/test; Kv* → Cloudflare Workers production.
 */
import type { AnalyzedReceipt, SuggestResult } from "@ahb/ai-orchestrator";

// ---------------------------------------------------------------------------
// Cloudflare KV namespace'in kullanılan alt kümesi (Workers tipi).
// @cloudflare/workers-types bağımlılığı olmadan tanımlanır.
// ---------------------------------------------------------------------------
export interface KVNamespace {
  get(key: string, options: { type: "json" }): Promise<unknown | null>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const ANALYSIS_TTL_S = 7 * 24 * 3600; // 7 gün
const SUGGEST_TTL_S = 24 * 3600; // 1 gün
const QUOTA_TTL_S = 48 * 3600; // 48 saat (güne göre anahtar + TTL)

export interface AnalysisCache {
  get(key: string): Promise<AnalyzedReceipt | undefined>;
  set(key: string, value: AnalyzedReceipt): Promise<void>;
}

export class InMemoryCache implements AnalysisCache {
  private readonly store = new Map<string, AnalyzedReceipt>();
  async get(key: string): Promise<AnalyzedReceipt | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: AnalyzedReceipt): Promise<void> {
    this.store.set(key, value);
  }
}

export interface SuggestionCache {
  get(key: string): Promise<SuggestResult | undefined>;
  set(key: string, value: SuggestResult): Promise<void>;
}

export class InMemorySuggestionCache implements SuggestionCache {
  private readonly store = new Map<string, SuggestResult>();
  async get(key: string): Promise<SuggestResult | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: SuggestResult): Promise<void> {
    this.store.set(key, value);
  }
}

export interface QuotaStore {
  consume(identifier: string): Promise<{ allowed: boolean; remaining: number }>;
}

/** Minimal Durable Object namespace (Workers runtime). */
export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export class InMemoryQuota implements QuotaStore {
  private readonly counts = new Map<string, { day: string; used: number }>();
  constructor(private readonly maxPerDay = 50) {}

  async consume(identifier: string): Promise<{ allowed: boolean; remaining: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const rec = this.counts.get(identifier);
    const used = rec && rec.day === day ? rec.used : 0;
    if (used >= this.maxPerDay) return { allowed: false, remaining: 0 };
    this.counts.set(identifier, { day, used: used + 1 });
    return { allowed: true, remaining: this.maxPerDay - (used + 1) };
  }
}

/** Atama önerisi kotası — OCR kotasından bağımsız. */
export class InMemorySuggestQuota implements QuotaStore {
  private readonly counts = new Map<string, { day: string; used: number }>();
  constructor(private readonly maxPerDay = 100) {}

  async consume(identifier: string): Promise<{ allowed: boolean; remaining: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const rec = this.counts.get(identifier);
    const used = rec && rec.day === day ? rec.used : 0;
    if (used >= this.maxPerDay) return { allowed: false, remaining: 0 };
    this.counts.set(identifier, { day, used: used + 1 });
    return { allowed: true, remaining: this.maxPerDay - (used + 1) };
  }
}

// ---------------------------------------------------------------------------
// KV tabanlı uygulamalar (Cloudflare Workers production)
// ---------------------------------------------------------------------------

export class KvAnalysisCache implements AnalysisCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<AnalyzedReceipt | undefined> {
    const val = await this.kv.get(`analysis:${key}`, { type: "json" });
    return (val as AnalyzedReceipt | null) ?? undefined;
  }

  async set(key: string, value: AnalyzedReceipt): Promise<void> {
    await this.kv.put(`analysis:${key}`, JSON.stringify(value), {
      expirationTtl: ANALYSIS_TTL_S,
    });
  }
}

export class KvSuggestionCache implements SuggestionCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<SuggestResult | undefined> {
    const val = await this.kv.get(`suggest:${key}`, { type: "json" });
    return (val as SuggestResult | null) ?? undefined;
  }

  async set(key: string, value: SuggestResult): Promise<void> {
    await this.kv.put(`suggest:${key}`, JSON.stringify(value), {
      expirationTtl: SUGGEST_TTL_S,
    });
  }
}

/**
 * Günlük kota — anahtar: `{prefix}:{identifier}:{YYYY-MM-DD}`.
 * Hem OCR (prefix="quota") hem atama önerisi (prefix="sqt") için kullanılır.
 */
/**
 * KV tabanlı günlük kota — yedek yol; eşzamanlı isteklerde yaklaşık sayım.
 * Production'da DoQuota tercih edilir.
 */
export class KvQuota implements QuotaStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly maxPerDay = 50,
    private readonly prefix = "quota",
  ) {}

  async consume(identifier: string): Promise<{ allowed: boolean; remaining: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const kvKey = `${this.prefix}:${identifier}:${day}`;
    const raw = await this.kv.get(kvKey);
    const used = raw ? parseInt(raw, 10) : 0;
    if (used >= this.maxPerDay) return { allowed: false, remaining: 0 };
    await this.kv.put(kvKey, String(used + 1), { expirationTtl: QUOTA_TTL_S });
    return { allowed: true, remaining: this.maxPerDay - (used + 1) };
  }
}

/** Durable Object tabanlı atomik günlük kota. */
export class DoQuota implements QuotaStore {
  constructor(
    private readonly ns: DurableObjectNamespace,
    private readonly maxPerDay = 50,
    private readonly prefix = "quota",
  ) {}

  async consume(identifier: string): Promise<{ allowed: boolean; remaining: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const id = this.ns.idFromName(`${this.prefix}:${identifier}:${day}`);
    const res = await this.ns.get(id).fetch("http://do/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPerDay: this.maxPerDay }),
    });
    if (!res.ok) return { allowed: false, remaining: 0 };
    return (await res.json()) as { allowed: boolean; remaining: number };
  }
}

// ---------------------------------------------------------------------------

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
