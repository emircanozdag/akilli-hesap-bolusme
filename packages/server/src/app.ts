/**
 * İnce AI orkestrasyon HTTP katmanı — DESIGN.md §6.2.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  OrchestrationError,
  ProviderError,
  orchestrate,
  type VisionProvider,
} from "@ahb/ai-orchestrator";
import {
  InMemoryCache,
  InMemoryQuota,
  sha256Hex,
  type AnalysisCache,
  type QuotaStore,
} from "./cache.js";

export interface AppConfig {
  provider: VisionProvider;
  cache?: AnalysisCache;
  quota?: QuotaStore;
  confidenceThreshold?: number;
}

interface AnalyzeBody {
  imageBase64?: string;
  mimeType?: string;
  locale?: string;
}

export function createApp(config: AppConfig): Hono {
  const cache = config.cache ?? new InMemoryCache();
  const quota = config.quota ?? new InMemoryQuota();
  const app = new Hono();

  app.use("/*", cors());

  app.get("/health", (c) => c.json({ ok: true, provider: config.provider.name }));

  app.post("/analyze", async (c) => {
    let body: AnalyzeBody;
    try {
      body = await c.req.json<AnalyzeBody>();
    } catch {
      return c.json({ error: "Geçersiz JSON gövdesi" }, 400);
    }

    if (!body.imageBase64 || !body.mimeType) {
      return c.json({ error: "imageBase64 ve mimeType zorunlu" }, 400);
    }

    const deviceId = c.req.header("x-device-id") ?? "anon";
    const q = await quota.consume(deviceId);
    if (!q.allowed) {
      return c.json({ error: "Günlük tarama kotası doldu", remaining: 0 }, 429);
    }

    const key = await sha256Hex(body.imageBase64);
    const hit = await cache.get(key);
    if (hit) {
      return c.json({ ...hit, cached: true, quotaRemaining: q.remaining });
    }

    const started = Date.now();
    const kb = Math.round((body.imageBase64.length * 3) / 4 / 1024);
    console.log(`[analyze] start device=${deviceId} image≈${kb}KB provider=${config.provider.name}`);

    try {
      const analyzed = await orchestrate(
        config.provider,
        {
          imageBase64: body.imageBase64,
          mimeType: body.mimeType,
          ...(body.locale ? { hints: { locale: body.locale } } : {}),
        },
        config.confidenceThreshold !== undefined
          ? { confidenceThreshold: config.confidenceThreshold }
          : {},
      );
      console.log(`[analyze] ok ${Date.now() - started}ms items=${analyzed.receipt.lineItems.length}`);
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

  return app;
}
