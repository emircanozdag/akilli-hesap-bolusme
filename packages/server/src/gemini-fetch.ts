/**
 * Gemini fetch sarmalayıcısı — ortama göre otomatik seçim.
 *
 * Node.js: undici tembel yüklenir; uzatılmış bağlantı (30 sn) + gövde (90 sn) zaman aşımı.
 * Cloudflare Workers: globalThis.fetch kullanılır.
 *
 * ÖNEMLİ: Ortam tespiti her istekte yapılır — Wrangler bundle'ı Node'da oluşturulduğu için
 * modül-seviyesi `const IS_NODE = ...` derleme zamanında yanlışlıkla true olabilir.
 */

type RawFetch = (url: string, init?: Record<string, unknown>) => Promise<Response>;

interface UndiciModule {
  Agent: new (opts: {
    connect?: { timeout?: number };
    bodyTimeout?: number;
    headersTimeout?: number;
  }) => unknown;
  fetch: RawFetch;
}

let undiciCache: { fetchFn: RawFetch; agent: unknown } | null = null;

async function resolveUndici(): Promise<{ fetchFn: RawFetch; agent: unknown }> {
  if (undiciCache) return undiciCache;
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const undici = req("undici") as UndiciModule;
  const agent = new undici.Agent({
    connect: { timeout: 30_000 },
    bodyTimeout: 90_000,
    headersTimeout: 90_000,
  });
  undiciCache = { fetchFn: undici.fetch, agent };
  return undiciCache;
}

function isWorkersRuntime(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers"
  );
}

/**
 * GeminiProvider'a enjekte edilecek fetch.
 * Her çağrıda runtime ortamı kontrol edilir.
 */
export const geminiFetch: typeof fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (isWorkersRuntime()) {
    return globalThis.fetch(url, init);
  }
  const { fetchFn, agent } = await resolveUndici();
  return fetchFn(url as string, {
    ...(init as Record<string, unknown>),
    dispatcher: agent,
  });
}) as typeof fetch;
