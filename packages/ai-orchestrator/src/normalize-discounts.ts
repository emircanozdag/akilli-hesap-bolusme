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

/** Servis/kuver satırı — ürün değil, charges.serviceChargeCents'e gider. */
const SERVICE_LINE_NAME =
  /^(servis(\s*(bedeli|%?\s*\d+))?|garsoniye|kuver|cover\s*charge|service(\s*charge)?|\d+\s*x\s*kuver)/i;

function isServiceLine(it: RawLineItem): boolean {
  if (it.totalPriceCents <= 0) return false;
  return SERVICE_LINE_NAME.test(normalizeName(it.name));
}

function isDiscountOrSummaryLine(it: RawLineItem): boolean {
  const norm = normalizeName(it.name);
  if (isServiceLine(it)) return false;
  if (it.totalPriceCents < 0) return true;
  if (DISCOUNT_LINE_NAME.test(norm)) return true;
  if (SUMMARY_LINE_NAME.test(norm)) return true;
  return false;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .trim();
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

const TAX_TOLERANCE_CENTS = 1;

function nearCents(a: number, b: number): boolean {
  return Math.abs(a - b) <= TAX_TOLERANCE_CENTS;
}

/** Fiş toplamı formülü (pipeline ile aynı). */
function totalFromCharges(c: RawCharges, productSum: number): number {
  return (
    productSum +
    (c.taxIncludedInItems ? 0 : c.taxCents) +
    c.serviceChargeCents +
    c.tipCents -
    c.discountCents
  );
}

/**
 * KDV dahil/ayrı tutarsızlığını giderir.
 * Sık OCR hatası: kalemler KDV dahil fiyatlarla doğru okunur ama charges.tax ayrı yazılır
 * ve taxIncludedInItems=false kalır → sahte "toplam tutmuyor" uyarısı.
 */
function reconcileTaxInCharges(charges: RawCharges, productSum: number): RawCharges {
  const base = { ...charges, subtotalCents: productSum };

  if (nearCents(productSum, base.totalCents)) {
    return { ...base, taxIncludedInItems: true };
  }

  if (base.serviceChargeCents > 0 && nearCents(productSum + base.serviceChargeCents, base.totalCents)) {
    return { ...base, taxIncludedInItems: true };
  }

  if (
    base.taxCents > 0 &&
    nearCents(
      productSum + base.taxCents + base.serviceChargeCents + base.tipCents - base.discountCents,
      base.totalCents,
    )
  ) {
    return { ...base, taxIncludedInItems: false };
  }

  if (nearCents(totalFromCharges(base, productSum), base.totalCents)) {
    return base;
  }

  return base;
}

/**
 * Fişte BASILI bahşiş tutarını servis bedeline taşır.
 *
 * Gerekçe kaynağa dayanır, ülkeye değil: OCR yalnızca fişte BASILI tutarları okur.
 * Gerçek bahşiş (tip) müşteri tarafından sonradan elle eklenir ve fişe basılı GELMEZ.
 * Dolayısıyla modelin charges.tipCents'e koyduğu tutar pratikte fişte basılı bir
 * servis/garsoniye/auto-gratuity bedelidir (ör. ABD'de "Service Charge %18", TR'de
 * "Servis"). Model bunu yanlış alana ("tip") yazınca UI'da "Bahşiş" olarak görünür.
 *
 * Yalnız servis bedeli HENÜZ bilinmiyorken (serviceChargeCents == 0) taşırız; model
 * ikisini de doğru ayırmışsa dokunmayız. Toplam değişmez (tip de servis de toplama
 * aynı şekilde eklenir) → aritmetik mutabakat bozulmaz.
 */
function reconcileTipAsService(charges: RawCharges): RawCharges {
  if (charges.serviceChargeCents > 0 || charges.tipCents <= 0) return charges;
  return { ...charges, serviceChargeCents: charges.tipCents, tipCents: 0 };
}

/** Ham OCR sonucunu bölüşüme uygun forma getirir (indirim satırları → charges.discountCents). */
export function normalizeDiscountLines(data: RawOcrResult): RawOcrResult {
  const products: RawLineItem[] = [];
  let discountFromLines = 0;
  let serviceFromLines = 0;

  for (const it of data.lineItems) {
    if (isServiceLine(it)) {
      serviceFromLines += it.totalPriceCents;
      continue;
    }
    if (isDiscountOrSummaryLine(it)) {
      discountFromLines += Math.abs(it.totalPriceCents);
      continue;
    }
    products.push(it);
  }

  if (products.length === 0) return data;

  const productSum = products.reduce((acc, it) => acc + it.totalPriceCents, 0);
  const discountCents = resolveDiscountCents(productSum, data.charges, discountFromLines);
  const serviceChargeCents = Math.max(data.charges.serviceChargeCents, serviceFromLines);

  const taxReconciled = reconcileTaxInCharges(
    {
      ...data.charges,
      subtotalCents: productSum,
      discountCents,
      serviceChargeCents,
    },
    productSum,
  );

  return {
    ...data,
    lineItems: products,
    charges: reconcileTipAsService(taxReconciled),
  };
}
