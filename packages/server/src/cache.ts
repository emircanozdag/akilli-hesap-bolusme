/**
 * Önbellek + kota soyutlaması — DESIGN.md §7 (maliyet) / §9.2 (kota).
 */
import type { AnalyzedReceipt, SuggestResult } from "@ahb/ai-orchestrator";

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

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
