/**
 * Cloudflare Workers girişi (deploy hedefi) — DESIGN.md §6.2.
 *
 * Singleton kalıbı: app ilk istekte oluşturulur, isolate ömrü boyunca yeniden kullanılır.
 * Bu sayede InMemoryQuota/InMemoryCache her istekte sıfırlanmaz.
 * Production'da AHB_KV binding varsa KV tabanlı kalıcı kota + cache devreye girer.
 */
import { createApp } from "./app.js";
import { buildAssignmentProvider, buildProvider, type Env } from "./config.js";
import {
  InMemoryCache,
  InMemoryQuota,
  InMemorySuggestQuota,
  InMemorySuggestionCache,
  KvAnalysisCache,
  DoQuota,
  KvQuota,
  KvSuggestionCache,
} from "./cache.js";

export { QuotaCounter } from "./quota-do.js";

type WorkerEnv = Env; // AHB_KV zaten Env içinde tanımlı

let singleton: ReturnType<typeof createApp> | null = null;

function getOrCreateApp(env: WorkerEnv): ReturnType<typeof createApp> {
  if (singleton) return singleton;

  const kv = env.AHB_KV;
  const cache = kv ? new KvAnalysisCache(kv) : new InMemoryCache();
  const suggestionCache = kv ? new KvSuggestionCache(kv) : new InMemorySuggestionCache();
  const quota = env.QUOTA_DO
    ? new DoQuota(env.QUOTA_DO, 50)
    : kv
      ? new KvQuota(kv, 50)
      : new InMemoryQuota();
  const suggestQuota = env.QUOTA_DO
    ? new DoQuota(env.QUOTA_DO, 100, "sqt")
    : kv
      ? new KvQuota(kv, 100, "sqt")
      : new InMemorySuggestQuota();

  singleton = createApp({
    provider: buildProvider(env),
    assignmentProvider: buildAssignmentProvider(env),
    cache,
    suggestionCache,
    quota,
    suggestQuota,
  });

  return singleton;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return getOrCreateApp(env).fetch(request);
  },
};
