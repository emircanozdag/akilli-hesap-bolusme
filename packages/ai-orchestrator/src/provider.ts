/**
 * Sağlayıcı-bağımsızlık sınırı — DESIGN.md §6.2.
 * Orkestrasyon yalnızca bu arayüze konuşur; Gemini/OpenAI/Textract takılıp çıkar.
 * Çıktı, zod ile doğrulanmamış HAM sonuçtur — doğrulama pipeline'da yapılır.
 */
import type { AnalyzeInput } from "./types.js";
import type { PartialLineItem } from "./partial-json.js";

export interface VisionProvider {
  readonly name: string;
  /** Görüntüyü işleyip ham (henüz doğrulanmamış) OCR JSON'u döndürür. */
  analyze(input: AnalyzeInput): Promise<unknown>;
}

/**
 * Akışlı tarama destekleyen sağlayıcı (vision-LLM). Kalemler model tarafından
 * üretildikçe `onItem` ile bildirilir (UI anlık doldurur); dönüş değeri yine
 * tam ham JSON'dur (nihai doğrulama pipeline'da yapılır).
 */
export interface StreamingVisionProvider extends VisionProvider {
  analyzeStream(input: AnalyzeInput, onItem: (item: PartialLineItem) => void): Promise<unknown>;
}

export function isStreamingProvider(p: VisionProvider): p is StreamingVisionProvider {
  return typeof (p as Partial<StreamingVisionProvider>).analyzeStream === "function";
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
  "TÜRK ADİSYONLARINA ÖZEL:",
  "- Adet: '2 ADET', '2 AD x 25,00', '2x' satırı kalemin QTY'sidir; ürün adına yazma.",
  "  Örn: 'KOLA 2 AD x 25,00  50,00' → name:'KOLA', qty:2, unitPriceCents:2500, totalPriceCents:5000.",
  "- Porsiyon: 'Tam'/'Yarım' kelimeleri tek başına ürün adı DEĞİLDİR; üstteki/yanındaki",
  "  ürün adına aittir. Örn: 'ARNAVUT CİĞERİ' + 'Tam' → name:'ARNAVUT CİĞERİ'.",
  "- Paylaşılan/çok porsiyonlu kalem: adedi qty'ye yaz; tek satırda bırak (kişilere sen bölme).",
  "- İkram/0 tutar: 'İKRAM', 'HEDİYE' ya da 0,00 yazan satır gerçek bir kalemdir → totalPriceCents:0.",
  "- KDV Türkiye'de genelde fiyata DAHİLDİR → taxIncludedInItems genellikle true.",
  "- 'ARA TOPLAM', 'TOPLAM', 'KDV', 'NAKİT', 'KREDİ KARTI', 'YEMEK ÇEKİ', 'YIYECEK', 'İÇECEK'",
  "  satırları KALEM DEĞİLDİR → lineItems'a koyma.",
  "- İndirim/kampanya ('Kampanya İndirim', 'SATIR IND', 'İSKONTO') satırlarını lineItems'a KOYMA;",
  "  toplam indirimi charges.discountCents'e yaz (pozitif kuruş, yalnızca BİR KEZ).",
  "  SATIR IND kalem indirimlerinin özeti ise discountCents'e SATIR IND tutarını yaz, kalemleri tekrarlama.",
  "  Ürün kalemleri BRÜT (indirim öncesi) fiyatıyla kalsın.",
].join("\n");
