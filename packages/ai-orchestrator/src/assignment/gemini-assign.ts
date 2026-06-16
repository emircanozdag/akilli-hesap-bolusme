import { ProviderError } from "../provider.js";
import { geminiAssignmentResponseSchema } from "./schema.js";
import type { SuggestInput } from "./types.js";

export interface AssignmentProvider {
  readonly name: string;
  suggest(input: SuggestInput): Promise<unknown>;
}

export interface GeminiAssignmentOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const ASSIGNMENT_TIMEOUT_MS = 15_000;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const SYSTEM_INSTRUCTION = [
  "Restoran adisyonu kalemlerini masadaki kişilere atarsın.",
  "Yalnızca verilen JSON şemasına uyan çıktı üret.",
  "personNames: girdideki kişi isimlerini AYNEN kullan (yazım değiştirme).",
  "lineItemId: girdideki kalem id alanını kullan.",
  "qty ≥ 2 kalemlerde weights toplamı qty'yi AŞAMAZ; emin değilsen o kalemi atla.",
  "Paylaşımlı yiyecekler (meze, pizza, tabak vb.) → tüm kişiler.",
  "Kişisel içecek/ana yemek → tek kişi veya qty kadar kişi.",
  "Belirsiz kalemleri assignments dizisine EKLEME.",
].join("\n");

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export class GeminiAssignmentProvider implements AssignmentProvider {
  readonly name = "gemini-assign";
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(private readonly opts: GeminiAssignmentOptions) {
    if (!opts.apiKey) throw new ProviderError("Gemini API anahtarı gerekli", "gemini-assign");
    this.model = opts.model ?? "gemini-2.5-flash-lite";
    this.baseUrl = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 400;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
  }

  async suggest(input: SuggestInput): Promise<unknown> {
    const body = this.buildBody(input);
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.opts.apiKey}`;
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(ASSIGNMENT_TIMEOUT_MS),
        });
      } catch (cause) {
        lastError = new ProviderError(`Gemini atama isteği başarısız (ağ)`, "gemini-assign", cause);
        if (attempt < this.maxAttempts) {
          await this.sleepImpl(this.retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = new ProviderError(
          `Gemini HTTP ${res.status}: ${detail.slice(0, 300)}`,
          "gemini-assign",
        );
        if (!RETRYABLE_STATUS.has(res.status)) throw error;
        lastError = error;
        if (attempt < this.maxAttempts) {
          await this.sleepImpl(this.retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }

      const payload = (await res.json()) as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new ProviderError("Gemini boş atama yanıtı", "gemini-assign", payload);
      }
      try {
        return JSON.parse(text);
      } catch (cause) {
        throw new ProviderError("Gemini atama JSON ayrıştırılamadı", "gemini-assign", cause);
      }
    }

    throw lastError ?? new ProviderError("Gemini atama denemeleri tükendi", "gemini-assign");
  }

  private buildBody(input: SuggestInput): unknown {
    const payload = {
      items: input.items.map((it) => ({
        id: it.id,
        name: it.name,
        qty: it.qty,
      })),
      people: input.people.map((p) => ({ id: p.id, name: p.name })),
      ...(input.hint ? { hint: input.hint } : {}),
    };

    return {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          parts: [
            {
              text: `Masadaki kişilere kalemleri ata:\n${JSON.stringify(payload, null, 2)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: geminiAssignmentResponseSchema,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
  }
}
