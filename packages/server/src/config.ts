/**
 * Ortam değişkenlerinden sağlayıcı kurulumu — sağlayıcı-bağımsızlık (§6.2).
 * Varsayılan (gemini) yol artık KADEMELİ: hızlı flash birincil + şüphede pro'ya yükselt
 * + Gemini erişilemezse Document AI'a düş (DESIGN.md §7 model kademesi).
 * Anahtar yoksa MockProvider'a düşer → anahtarsız yerel geliştirme/test.
 *
 * NOT: node:fs ve google-auth-library yalnızca DocAI hata ayıklama / Node sunucu yolunda
 * kullanılır; Workers'ta parse edilirken kırılmamaları için tembel (dinamik) import edilir.
 */
import {
  DocumentAiProvider,
  EscalatingProvider,
  GeminiProvider,
  GeminiAssignmentProvider,
  MockProvider,
  MockAssignmentProvider,
  type AssignmentProvider,
  type VisionProvider,
} from "@ahb/ai-orchestrator";
import { geminiFetch } from "./gemini-fetch.js";
import type { KVNamespace, DurableObjectNamespace } from "./cache.js";

export interface Env {
  AHB_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  /** Şüpheli sonuçta yükseltilecek güçlü model. "off"/"none" → yükseltme kapalı. Varsayılan gemini-2.5-pro. */
  AHB_ESCALATION_MODEL?: string;
  /** Gemini erişilemezse düşülecek yedek sağlayıcı: "documentai" | (boş → yedek yok). */
  AHB_FALLBACK?: string;
  DOCAI_PROJECT_ID?: string;
  DOCAI_LOCATION?: string;
  DOCAI_PROCESSOR_ID?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  /** "1" ise son Document AI ham yanıtı docai-debug.json'a yazılır. */
  DOCAI_DEBUG?: string;
  /** Günlük atama önerisi kotası (varsayılan 100). */
  SUGGEST_QUOTA_PER_DAY?: string;
  /** Cloudflare KV binding — Workers production'da kalıcı kota + cache. */
  AHB_KV?: KVNamespace;
  /** Atomik günlük kota — KV yarışını önler; varsa KvQuota yerine kullanılır. */
  QUOTA_DO?: DurableObjectNamespace;
}

const ESCALATION_OFF = new Set(["", "off", "none", "kapali", "kapalı"]);

export function buildProvider(env: Env): VisionProvider {
  const choice = (env.AHB_PROVIDER ?? "").toLowerCase();

  if (choice === "documentai") {
    const docAi = buildDocumentAi(env);
    if (!docAi) {
      throw new Error("AHB_PROVIDER=documentai için DOCAI_PROJECT_ID ve DOCAI_PROCESSOR_ID gerekli");
    }
    return docAi;
  }

  if (choice === "gemini" || (!choice && env.GEMINI_API_KEY)) {
    return buildGeminiEscalating(env);
  }

  return new MockProvider();
}

/** Atama önerisi sağlayıcısı — GEMINI_API_KEY varsa flash-lite, yoksa mock. */
export function buildAssignmentProvider(env: Env): AssignmentProvider {
  if (env.GEMINI_API_KEY) {
    return new GeminiAssignmentProvider({
      apiKey: env.GEMINI_API_KEY,
      fetchImpl: geminiFetch,
    });
  }
  return new MockAssignmentProvider();
}

/**
 * Kademeli Gemini sağlayıcısı: flash birincil + (opsiyonel) pro yükseltme + (opsiyonel) DocAI yedek.
 */
function buildGeminiEscalating(env: Env): VisionProvider {
  if (!env.GEMINI_API_KEY) {
    throw new Error("AHB_PROVIDER=gemini için GEMINI_API_KEY gerekli");
  }
  const primaryModel = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const primary = new GeminiProvider({
    apiKey: env.GEMINI_API_KEY,
    model: primaryModel,
    fallbackModels: ["gemini-2.5-flash-lite", "gemini-2.0-flash"],
    fetchImpl: geminiFetch,
  });

  const escalationModel = (env.AHB_ESCALATION_MODEL ?? "gemini-2.5-pro").toLowerCase().trim();
  const escalation =
    ESCALATION_OFF.has(escalationModel) || escalationModel === primaryModel.toLowerCase()
      ? undefined
      : new GeminiProvider({
          apiKey: env.GEMINI_API_KEY,
          model: env.AHB_ESCALATION_MODEL ?? "gemini-2.5-pro",
          fallbackModels: [],
          fetchImpl: geminiFetch,
        });

  const fallback =
    (env.AHB_FALLBACK ?? "").toLowerCase() === "documentai" ? buildDocumentAi(env) : null;

  return new EscalatingProvider({
    primary,
    ...(escalation ? { escalation } : {}),
    ...(fallback ? { fallback } : {}),
    onEscalation: (info) =>
      console.log(`[provider] yükseltme: ${info.from} → ${info.to} (${info.reason})`),
    onFallback: (info) =>
      console.warn(`[provider] yedeğe düşüş: ${info.from} → ${info.to} (${info.cause})`),
  });
}

/** Document AI sağlayıcısı — env eksikse null (yedek olarak sessizce atlanır). */
function buildDocumentAi(env: Env): DocumentAiProvider | null {
  if (!env.DOCAI_PROJECT_ID || !env.DOCAI_PROCESSOR_ID) return null;
  return new DocumentAiProvider({
    projectId: env.DOCAI_PROJECT_ID,
    location: env.DOCAI_LOCATION ?? "eu",
    processorId: env.DOCAI_PROCESSOR_ID,
    getAccessToken: makeGoogleAccessTokenFn(),
    ...(env.DOCAI_DEBUG === "1"
      ? {
          onRawDocument: (doc: unknown) => {
            // node:fs yalnızca Node ortamında; Workers'ta sessizce atlanır.
            void (async () => {
              try {
                const { mkdirSync, writeFileSync } = await import("node:fs");
                const json = JSON.stringify(doc, null, 2);
                const latest = new URL("../docai-debug.json", import.meta.url).pathname;
                writeFileSync(latest, json);
                try {
                  const dir = new URL("../debug/", import.meta.url).pathname;
                  mkdirSync(dir, { recursive: true });
                  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                  writeFileSync(`${dir}docai-${stamp}.json`, json);
                } catch {
                  /* arşiv yazılamazsa sessiz geç */
                }
                console.log(`[docai-debug] ham yanıt yazıldı → ${latest}`);
              } catch {
                /* Workers ortamında node:fs yok — sessiz geç */
              }
            })();
          },
        }
      : {}),
  });
}

/**
 * Servis hesabıyla (GOOGLE_APPLICATION_CREDENTIALS) Google access token üreten kapanış.
 * google-auth-library tembel yüklenir → Workers parse sürecinde kırılmaz.
 * Yalnızca Node + DocAI etkin yolda çalışır.
 */
function makeGoogleAccessTokenFn(): () => Promise<string> {
  let clientPromise: Promise<{ getAccessToken(): Promise<{ token: string | null }> }> | undefined;
  return async () => {
    if (!clientPromise) {
      const { GoogleAuth } = await import("google-auth-library") as {
        GoogleAuth: new (opts: { scopes: string[] }) => {
          getClient(): Promise<{ getAccessToken(): Promise<{ token: string | null }> }>;
        };
      };
      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      clientPromise = auth.getClient();
    }
    const client = await clientPromise;
    const token = (await client.getAccessToken()).token;
    if (!token) throw new Error("Google access token alınamadı");
    return token;
  };
}
