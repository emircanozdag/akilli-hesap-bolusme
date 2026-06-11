/**
 * Sağlayıcı-bağımsızlık sınırı — DESIGN.md §6.2.
 * Orkestrasyon yalnızca bu arayüze konuşur; Gemini/OpenAI/Textract takılıp çıkar.
 * Çıktı, zod ile doğrulanmamış HAM sonuçtur — doğrulama pipeline'da yapılır.
 */
import type { AnalyzeInput } from "./types.js";

export interface VisionProvider {
  readonly name: string;
  /** Görüntüyü işleyip ham (henüz doğrulanmamış) OCR JSON'u döndürür. */
  analyze(input: AnalyzeInput): Promise<unknown>;
}

export class ProviderError extends Error {
  override name = "ProviderError";
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** Vision-LLM'lere verilecek ortak sistem talimatı (DESIGN.md §7). */
export const SYSTEM_INSTRUCTION = [
  "Sen bir restoran fişi/adisyonu çıkarım motorusun.",
  "Görseldeki bilgiyi yalnızca verilen JSON şemasına uygun üret.",
  "KURALLAR:",
  "- Tüm parasal değerler KURUŞ cinsinden TAM SAYI olmalı (19,99 → 1999).",
  "- ASLA matematik/hesaplama yapma; yalnızca fişte YAZAN değerleri raporla.",
  "- Görmediğin bir değeri UYDURMA; emin değilsen confidence'ı düşür ve flag ekle.",
  "- Her kaleme 0-1 arası confidence ver.",
  "- KDV/servis kalem fiyatlarına dahilse taxIncludedInItems=true işaretle.",
  "- currency alanını ISO 4217 olarak ver (TRY, USD, EUR...).",
  "- Sadece geçerli JSON döndür; açıklama/markdown ekleme.",
].join("\n");
