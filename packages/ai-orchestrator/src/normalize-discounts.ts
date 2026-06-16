/**
 * İndirim satırlarını kalem listesinden ayırır — tüm sağlayıcılar için ortak (§7).
 *
 * DocAI negatif "Kampanya İndirim" satırlarını mapDocAiToRaw'da ayırır; Gemini ise
 * bunları lineItems'a koyup charges.discountCents'i de doldurabiliyor → mobil özet
 * hem negatif kalemi topluyor hem discountCents düşüyor (çift indirim).
 *
 * Kural: lineItems yalnızca atanabilir ürünler (brüt); toplam indirim charges.discountCents.
 */
import type { RawCharges, RawLineItem, RawOcrResult } from "./schema.js";

/** İndirim/iskonto/kampanya satırı — ürün değil, bölüşüme girmez. */
const DISCOUNT_LINE_NAME =
  /(kampanya\s*indirim|satir\s*ind|line\s*disc|indirim|iskonto|discount|coupon|kupon|promo|isk\.)/i;

/** Özet/kategori satırları (YIYECEK/İÇECEK/ARA TOPLAM vb.) — kalem değil. */
const SUMMARY_LINE_NAME =
  /^(ara\s*toplam|toplam|kdv|tutar|yiyecek|icecek|ice\s*cek|nakit|kredi|odeme|tahsil|genel\s*toplam)$/i;

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .trim();
}

function isDiscountOrSummaryLine(it: RawLineItem): boolean {
  const norm = normalizeName(it.name);
  if (it.totalPriceCents < 0) return true;
  if (DISCOUNT_LINE_NAME.test(norm)) return true;
  if (SUMMARY_LINE_NAME.test(norm)) return true;
  return false;
}

/** Brüt kalem toplamından fiş toplamına göre zorunlu indirim tutarını çıkarır. */
function impliedDiscountCents(productSum: number, c: RawCharges): number {
  const tax = c.taxIncludedInItems ? 0 : c.taxCents;
  return productSum + c.serviceChargeCents + c.tipCents + tax - c.totalCents;
}

/**
 * charges.discountCents ile kalem listesinden çıkarılan indirimi birleştirir.
 *
 * Türk fişlerinde sık desen: kalem başı "Kampanya İndirim" + altta "SATIR IND"
 * (aynı tutarın özeti) + charges.discountCents — üçünü toplamak indirimi ikiye katlar.
 * En güvenilir kaynak: brüt kalem toplamı − fiş toplamı (aritmetik mutabakat).
 */
function resolveDiscountCents(
  productSum: number,
  c: RawCharges,
  discountFromLines: number,
): number {
  // İndirim KANITI: fişten ayıklanmış bir indirim/iskonto satırı ya da sağlayıcının açıkça
  // bildirdiği charges.discountCents. Kanıt yoksa kalem toplamı ile fiş toplamı arasındaki
  // fark İNDİRİM DEĞİLDİR (eksik/yanlış okunan kalem veya hatalı toplamdır) → hayalet indirim
  // üretmeyiz; 0 döneriz ve dengesizliği pipeline'ın aritmetik kontrolü kullanıcıya onaylatır.
  const hasDiscountEvidence = discountFromLines > 0 || c.discountCents > 0;
  if (!hasDiscountEvidence) return 0;

  const implied = impliedDiscountCents(productSum, c);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;

  // Brüt kalemler fiş toplamından büyükse aradaki fark = indirim (SATIR IND tekrarını yok sayar).
  if (productSum > c.totalCents + (c.taxIncludedInItems ? 0 : c.taxCents)) {
    return Math.max(0, Math.round(implied));
  }

  if (near(productSum, c.totalCents)) return 0;

  if (implied > 0) {
    if (c.discountCents > 0 && near(implied, c.discountCents)) return c.discountCents;
    if (discountFromLines > 0 && near(implied, discountFromLines)) return discountFromLines;
    return Math.round(implied);
  }

  return Math.min(Math.max(c.discountCents, discountFromLines), productSum);
}

/** Ham OCR sonucunu bölüşüme uygun forma getirir (indirim satırları → charges.discountCents). */
export function normalizeDiscountLines(data: RawOcrResult): RawOcrResult {
  const products: RawLineItem[] = [];
  let discountFromLines = 0;

  for (const it of data.lineItems) {
    if (isDiscountOrSummaryLine(it)) {
      discountFromLines += Math.abs(it.totalPriceCents);
      continue;
    }
    products.push(it);
  }

  if (products.length === 0) return data;

  const productSum = products.reduce((acc, it) => acc + it.totalPriceCents, 0);
  const discountCents = resolveDiscountCents(productSum, data.charges, discountFromLines);

  return {
    ...data,
    lineItems: products,
    charges: {
      ...data.charges,
      subtotalCents: productSum,
      discountCents,
    },
  };
}
