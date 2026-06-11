/**
 * GeminiProvider — Google Gemini Vision (görsel → yapılandırılmış JSON).
 * Uluslararası fiş OCR'ı için seçildi: çok dilli, ucuz, native responseSchema (§7).
 * SDK'ya bağımlı kalmamak için doğrudan REST (fetch) kullanır → her runtime'da çalışır
 * (Cloudflare Workers dahil). Anahtar yalnızca backend'de bulunur (§9.2).
 */
import { ProviderError, SYSTEM_INSTRUCTION, type VisionProvider } from "../provider.js";
import { geminiResponseSchema } from "../schema.js";
import type { AnalyzeInput } from "../types.js";

export interface GeminiOptions {
  apiKey: string;
  /** Birincil çok dilli model. */
  model?: string;
  /**
   * Birincil model geçici olarak erişilemezse (aşırı yük/kota) sırayla denenecek
   * yedek modeller (DESIGN.md §7 "model kademesi"). Varsayılan: flash-lite + 2.0-flash.
   */
  fallbackModels?: string[];
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Geçici hatalarda (503/429/5xx + ağ) model başına toplam deneme sayısı. Varsayılan 3. */
  maxAttempts?: number;
  /** İlk geri çekilme gecikmesi (ms); her denemede üstel olarak ikiye katlanır. */
  retryBaseDelayMs?: number;
  /** Test edilebilirlik için enjekte edilebilir bekleme. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** Yeniden denemeye değer geçici HTTP durumları (Gemini aşırı yük / kota / sunucu). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const DEFAULT_FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-2.0-flash"];
const GEMINI_REQUEST_TIMEOUT_MS = 90_000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Tek bir model denemesinin sonucu — geçici hata ise üst katman yedek modele geçer. */
type ModelAttempt =
  | { ok: true; value: unknown }
  | { ok: false; error: ProviderError; retryable: boolean };

export class GeminiProvider implements VisionProvider {
  readonly name = "gemini";
  /** Birincil + yedek modeller, denenme sırasıyla. */
  private readonly models: string[];
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(private readonly opts: GeminiOptions) {
    if (!opts.apiKey) throw new ProviderError("Gemini API anahtarı gerekli", "gemini");
    const primary = opts.model ?? "gemini-2.5-flash";
    const fallbacks = opts.fallbackModels ?? DEFAULT_FALLBACK_MODELS;
    this.models = [...new Set([primary, ...fallbacks])];
    this.baseUrl = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
  }

  async analyze(input: AnalyzeInput): Promise<unknown> {
    const body = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          parts: [
            { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } },
            { text: "Bu restoran fişini şemaya göre çıkar." },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: geminiResponseSchema,
        temperature: 0,
      },
    };

    let lastError: ProviderError | undefined;

    for (const model of this.models) {
      const result = await this.tryModel(model, body);
      if (result.ok) return result.value;
      lastError = result.error;
      if (!result.retryable) throw result.error;
    }

    throw lastError ?? new ProviderError("Gemini denemeleri tükendi", "gemini");
  }

  private async tryModel(model: string, body: unknown): Promise<ModelAttempt> {
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.opts.apiKey}`;
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        lastError = new ProviderError(`Gemini isteği başarısız (ağ, ${model})`, "gemini", cause);
        if (await this.maybeBackoff(attempt)) continue;
        return { ok: false, error: lastError, retryable: true };
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = new ProviderError(
          `Gemini HTTP ${res.status} (${model}): ${detail.slice(0, 300)}`,
          "gemini",
        );
        if (!RETRYABLE_STATUS.has(res.status)) return { ok: false, error, retryable: false };
        lastError = error;
        if (await this.maybeBackoff(attempt)) continue;
        return { ok: false, error, retryable: true };
      }

      const payload = (await res.json()) as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return {
          ok: false,
          error: new ProviderError("Gemini boş yanıt döndürdü", "gemini", payload),
          retryable: false,
        };
      }

      try {
        return { ok: true, value: JSON.parse(text) };
      } catch (cause) {
        return {
          ok: false,
          error: new ProviderError("Gemini JSON ayrıştırılamadı", "gemini", cause),
          retryable: false,
        };
      }
    }

    return {
      ok: false,
      error: lastError ?? new ProviderError("Gemini denemeleri tükendi", "gemini"),
      retryable: true,
    };
  }

  private async maybeBackoff(attempt: number): Promise<boolean> {
    if (attempt >= this.maxAttempts) return false;
    await this.sleepImpl(this.retryBaseDelayMs * 2 ** (attempt - 1));
    return true;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}
