/**
 * İnce AI orkestrasyon HTTP katmanı — DESIGN.md §6.2.
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  OrchestrationError,
  ProviderError,
  AssignmentNormalizeError,
  analyzeRaw,
  isStreamingProvider,
  orchestrate,
  suggestAssignments,
  suggestInputSchema,
  type AssignmentProvider,
  type VisionProvider,
} from "@ahb/ai-orchestrator";
import {
  InMemoryCache,
  InMemoryQuota,
  InMemorySuggestQuota,
  InMemorySuggestionCache,
  sha256Hex,
  type AnalysisCache,
  type QuotaStore,
  type SuggestionCache,
} from "./cache.js";

export interface AppConfig {
  provider: VisionProvider;
  assignmentProvider?: AssignmentProvider;
  cache?: AnalysisCache;
  suggestionCache?: SuggestionCache;
  quota?: QuotaStore;
  suggestQuota?: QuotaStore;
  confidenceThreshold?: number;
}

interface AnalyzeBody {
  imageBase64?: string;
  mimeType?: string;
  locale?: string;
}

interface ParsedImage {
  imageBase64: string;
  mimeType: string;
  locale?: string;
}

/**
 * İstek gövdesini görüntüye çevirir. İki yol:
 *  - binary (content-type image/*): ham bayt → base64 (en hızlı; +%33 JSON şişmesi yok).
 *    locale `x-locale` header'ından ya da `?locale=` sorgusundan alınır.
 *  - JSON (content-type application/json): { imageBase64, mimeType, locale } (geriye dönük uyum).
 */
async function parseImage(c: Context): Promise<ParsedImage | { error: string }> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.startsWith("image/")) {
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength === 0) return { error: "Boş görüntü gövdesi" };
    const imageBase64 = bytesToBase64(new Uint8Array(buf));
    const locale = c.req.header("x-locale") ?? c.req.query("locale");
    return { imageBase64, mimeType: contentType, ...(locale ? { locale } : {}) };
  }

  let body: AnalyzeBody;
  try {
    body = await c.req.json<AnalyzeBody>();
  } catch {
    return { error: "Geçersiz JSON gövdesi" };
  }
  if (!body.imageBase64 || !body.mimeType) {
    return { error: "imageBase64 ve mimeType zorunlu" };
  }
  return {
    imageBase64: body.imageBase64,
    mimeType: body.mimeType,
    ...(body.locale ? { locale: body.locale } : {}),
  };
}

/** Uint8Array → base64 (runtime-bağımsız; Buffer ya da btoa varsa onları kullanır). */
function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function createApp(config: AppConfig): Hono {
  const cache = config.cache ?? new InMemoryCache();
  const suggestionCache = config.suggestionCache ?? new InMemorySuggestionCache();
  const quota = config.quota ?? new InMemoryQuota();
  const suggestQuota = config.suggestQuota ?? new InMemorySuggestQuota();
  const assignmentProvider = config.assignmentProvider;
  const app = new Hono();

  app.use("/*", cors());

  app.get("/health", (c) => c.json({ ok: true, provider: config.provider.name }));

  app.post("/analyze", async (c) => {
    const parsed = await parseImage(c);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    const deviceId = c.req.header("x-device-id") ?? "anon";
    const q = await quota.consume(deviceId);
    if (!q.allowed) {
      return c.json({ error: "Günlük tarama kotası doldu", remaining: 0 }, 429);
    }

    const key = await sha256Hex(parsed.imageBase64);
    const hit = await cache.get(key);
    if (hit) {
      return c.json({ ...hit, cached: true, quotaRemaining: q.remaining });
    }

    const started = Date.now();
    const kb = Math.round((parsed.imageBase64.length * 3) / 4 / 1024);
    console.log(`[analyze] start device=${deviceId} image≈${kb}KB provider=${config.provider.name}`);

    try {
      const analyzed = await orchestrate(
        config.provider,
        {
          imageBase64: parsed.imageBase64,
          mimeType: parsed.mimeType,
          ...(parsed.locale ? { hints: { locale: parsed.locale } } : {}),
        },
        config.confidenceThreshold !== undefined
          ? { confidenceThreshold: config.confidenceThreshold }
          : {},
      );
      console.log(
        `[analyze] ok ${Date.now() - started}ms provider=${config.provider.name} items=${analyzed.receipt.lineItems.length} balanced=${analyzed.arithmetic.balanced}`,
      );
      await cache.set(key, analyzed);
      return c.json({ ...analyzed, quotaRemaining: q.remaining });
    } catch (err) {
      console.error(`[analyze] fail ${Date.now() - started}ms`, err);
      if (err instanceof OrchestrationError) {
        return c.json({ error: err.message, code: err.code, issues: err.issues }, 422);
      }
      if (err instanceof ProviderError) {
        if (/HTTP (?:429|503)|UNAVAILABLE|high demand|overloaded/i.test(err.message)) {
          return c.json(
            {
              error: "AI servisi şu an yoğun. Lütfen birkaç saniye sonra tekrar deneyin.",
              code: "PROVIDER_BUSY",
              detail: err.message,
            },
            503,
          );
        }
        return c.json({ error: "AI sağlayıcı hatası", detail: err.message }, 502);
      }
      return c.json({ error: "Beklenmeyen hata" }, 500);
    }
  });

  // Akışlı tarama (SSE): kalemler model tarafından üretildikçe `item` olaylarıyla
  // gönderilir, sonda doğrulanmış tam sonuç `result` olayıyla. İstemci algılanan
  // gecikmeyi düşürmek için kalemleri anında gösterebilir (DESIGN.md §7).
  app.post("/analyze/stream", async (c) => {
    const parsed = await parseImage(c);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    const deviceId = c.req.header("x-device-id") ?? "anon";
    const q = await quota.consume(deviceId);
    if (!q.allowed) return c.json({ error: "Günlük tarama kotası doldu", remaining: 0 }, 429);

    const orchestrateOptions =
      config.confidenceThreshold !== undefined
        ? { confidenceThreshold: config.confidenceThreshold }
        : {};
    const analyzeInput = {
      imageBase64: parsed.imageBase64,
      mimeType: parsed.mimeType,
      ...(parsed.locale ? { hints: { locale: parsed.locale } } : {}),
    };
    const key = await sha256Hex(parsed.imageBase64);

    return streamSSE(c, async (sse) => {
      const emit = (event: string, data: unknown): Promise<void> =>
        sse.writeSSE({ event, data: JSON.stringify(data) });

      try {
        const hit = await cache.get(key);
        if (hit) {
          await emit("result", { ...hit, cached: true, quotaRemaining: q.remaining });
          return;
        }

        await emit("phase", { phase: "analyzing" });
        const started = Date.now();

        let analyzed;
        if (isStreamingProvider(config.provider)) {
          const raw = await config.provider.analyzeStream(analyzeInput, (item) => {
            void emit("item", item);
          });
          analyzed = analyzeRaw(raw, analyzeInput, orchestrateOptions);
        } else {
          analyzed = await orchestrate(config.provider, analyzeInput, orchestrateOptions);
        }

        console.log(
          `[analyze/stream] ok ${Date.now() - started}ms provider=${config.provider.name} items=${analyzed.receipt.lineItems.length}`,
        );
        await cache.set(key, analyzed);
        await emit("result", { ...analyzed, quotaRemaining: q.remaining });
      } catch (err) {
        const message =
          err instanceof OrchestrationError
            ? err.message
            : err instanceof ProviderError
              ? "AI sağlayıcı hatası"
              : "Beklenmeyen hata";
        console.error("[analyze/stream] fail", err);
        await emit("error", { error: message });
      }
    });
  });

  app.post("/suggest-assignments", async (c) => {
    if (!assignmentProvider) {
      return c.json({ error: "Atama önerisi yapılandırılmamış" }, 503);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Geçersiz JSON gövdesi" }, 400);
    }

    const parsed = suggestInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Geçersiz atama girdisi", issues: parsed.error.issues },
        400,
      );
    }

    const deviceId = c.req.header("x-device-id") ?? "anon";
    const q = await suggestQuota.consume(deviceId);
    if (!q.allowed) {
      return c.json({ error: "Günlük atama önerisi kotası doldu", remaining: 0 }, 429);
    }

    const canonical = JSON.stringify({
      items: [...parsed.data.items].sort((a, b) => a.id.localeCompare(b.id)),
      people: [...parsed.data.people].sort((a, b) => a.id.localeCompare(b.id)),
      hint: parsed.data.hint ?? "",
      locale: parsed.data.locale ?? "",
    });
    const key = await sha256Hex(canonical);
    const hit = await suggestionCache.get(key);
    if (hit) {
      return c.json({ ...hit, cached: true, quotaRemaining: q.remaining });
    }

    const started = Date.now();
    console.log(
      `[suggest] start device=${deviceId} items=${parsed.data.items.length} people=${parsed.data.people.length}`,
    );

    try {
      const result = await suggestAssignments(parsed.data, assignmentProvider);
      console.log(
        `[suggest] ok ${Date.now() - started}ms partial=${result.partial} keys=${Object.keys(result.assignments).length}`,
      );
      await suggestionCache.set(key, result);
      return c.json({ ...result, quotaRemaining: q.remaining });
    } catch (err) {
      console.error(`[suggest] fail ${Date.now() - started}ms`, err);
      if (err instanceof AssignmentNormalizeError) {
        return c.json({ error: err.message, code: err.code, issues: err.issues }, 422);
      }
      if (err instanceof ProviderError) {
        if (/HTTP (?:429|503)|UNAVAILABLE|high demand|overloaded/i.test(err.message)) {
          return c.json(
            {
              error: "AI servisi şu an yoğun. Lütfen birkaç saniye sonra tekrar deneyin.",
              code: "PROVIDER_BUSY",
              detail: err.message,
            },
            503,
          );
        }
        return c.json({ error: "AI sağlayıcı hatası", detail: err.message }, 502);
      }
      return c.json({ error: "Beklenmeyen hata" }, 500);
    }
  });

  return app;
}
