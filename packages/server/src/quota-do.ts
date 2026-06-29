/**
 * Günlük kota sayacı — cihaz+gün başına tek DO örneği, atomik artış.
 * KV read-modify-write yarışını önler (DESIGN.md §9.2).
 */

/** Minimal Durable Object state (Workers runtime). */
export interface DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  };
}

interface QuotaRecord {
  day: string;
  used: number;
}

export class QuotaCounter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/consume") {
      return new Response("Not found", { status: 404 });
    }

    let maxPerDay: number;
    try {
      ({ maxPerDay } = (await request.json()) as { maxPerDay: number });
    } catch {
      return Response.json({ error: "Geçersiz gövde" }, { status: 400 });
    }
    if (!Number.isFinite(maxPerDay) || maxPerDay < 0) {
      return Response.json({ error: "Geçersiz maxPerDay" }, { status: 400 });
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = "count";
    let rec = await this.state.storage.get<QuotaRecord>(key);
    if (!rec || rec.day !== day) rec = { day, used: 0 };

    if (rec.used >= maxPerDay) {
      return Response.json({ allowed: false, remaining: 0 });
    }

    const next = { day, used: rec.used + 1 };
    await this.state.storage.put(key, next);
    return Response.json({ allowed: true, remaining: maxPerDay - next.used });
  }
}
