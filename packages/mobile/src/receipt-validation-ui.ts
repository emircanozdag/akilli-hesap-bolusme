/**
 * OCR doğrulama çıktısını kullanıcıya gösterilecek Türkçe mesajlara çevirir.
 */
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import type { Charges } from "@ahb/split-engine";
import { formatCents } from "./logic";

const CONFIRMATION_LABELS: Record<string, string> = {
  total: "fiş toplamı",
  currency: "para birimi",
  subtotal: "ara toplam",
};

const TOLERANCE_CENTS = 1;

export interface ReceiptValidationMessages {
  /** Bilgilendirme — fiş okundu, kontrol önerisi yok. */
  info: string[];
  /** Dikkat — kullanıcı bir şeyi kontrol etmeli. */
  warnings: string[];
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE_CENTS;
}

function money(currency: string, cents: number): string {
  return `${currency}${formatCents(Math.abs(cents))}`;
}

/**
 * Kalemler toplamı fiş toplamıyla (KDV dahil/ayrı) uyumlu mu?
 *
 * `itemsSumOverride` verilirse (kullanıcı kalemleri elle düzeltmişse) OCR'ın
 * okuduğu tutar yerine GÜNCEL kalem toplamı kullanılır → düzeltme sonrası uyarı
 * anında güncellenir.
 */
export function itemsAlignWithReceiptTotal(
  analysis: AnalyzedReceipt,
  itemsSumOverride?: number,
): boolean {
  const declaredTotalCents = analysis.arithmetic.declaredTotalCents;
  const itemsSumCents = itemsSumOverride ?? analysis.arithmetic.itemsSumCents;
  const c = analysis.receipt.charges;

  if (near(itemsSumCents, declaredTotalCents)) return true;

  if (
    near(
      itemsSumCents + c.serviceChargeCents + c.tipCents - c.discountCents,
      declaredTotalCents,
    )
  ) {
    return true;
  }

  if (!c.taxIncludedInItems && c.taxCents > 0) {
    const withTax =
      itemsSumCents + c.taxCents + c.serviceChargeCents + c.tipCents - c.discountCents;
    if (near(withTax, declaredTotalCents)) return true;
  }

  // Override yoksa OCR'ın kendi denge kararına güven; override varsa yukarıdaki
  // güncel-toplam kontrolleri belirleyicidir (eski "balanced" bayrağı yanıltmasın).
  return itemsSumOverride === undefined ? analysis.arithmetic.balanced : false;
}

function itemsVsTotalMessage(
  analysis: AnalyzedReceipt,
  currency: string,
  itemsSumOverride?: number,
): string | null {
  const declaredTotalCents = analysis.arithmetic.declaredTotalCents;
  const itemsSumCents = itemsSumOverride ?? analysis.arithmetic.itemsSumCents;

  if (itemsAlignWithReceiptTotal(analysis, itemsSumOverride)) return null;

  // Bilinen ücretler hesaba katıldıktan sonra kalan açık.
  const c = analysis.receipt.charges;
  const taxPart = c.taxIncludedInItems ? 0 : c.taxCents;
  const accounted =
    itemsSumCents + taxPart + c.serviceChargeCents + c.tipCents - c.discountCents;
  const extra = declaredTotalCents - accounted;

  // Fiş toplamı, kalemler + bilinen ücretlerden FAZLA ise bir şey eksik kalmış olabilir
  // (okunmayan kalem ya da kaleme yansımayan servis). Kullanıcıdan kalemleri kontrol
  // etmesini isteyelim; bilemediğimiz tutarı "servis" diye tahmin etmiyoruz.
  if (extra > TOLERANCE_CENTS) {
    return `Fişteki toplam, kalemlerden ${money(currency, extra)} fazla görünüyor — eksik bir kalem ya da servis olabilir, kalemleri kontrol et.`;
  }

  // Kalemler fiş toplamından fazla → fazla/yanlış okuma; kontrol ettir.
  return `Okunan kalemler fişteki toplamdan ${money(currency, extra)} fazla görünüyor — kalemleri ve tutarları kontrol et.`;
}

/** Fişten okunan KDV / servis özeti (her satır ayrı). */
function receiptInfoLines(c: Charges, currency: string): string[] {
  const lines: string[] = [];

  if (c.taxIncludedInItems && c.taxCents > 0) {
    lines.push(`Fiyatlar KDV dahil (fişte ${money(currency, c.taxCents)}).`);
  } else if (!c.taxIncludedInItems && c.taxCents > 0) {
    lines.push(`KDV ayrı hesaplanır: ${money(currency, c.taxCents)}.`);
  }

  if (c.serviceChargeCents > 0) {
    lines.push(
      `Servis bedeli ${money(currency, c.serviceChargeCents)} — kişilere oransal dağıtılır.`,
    );
  }

  return lines;
}

/** needsConfirmation alan adlarını okunaklı etiketlere çevirir. */
export function confirmationFieldLabels(fields: readonly string[]): string[] {
  return fields.map((f) => CONFIRMATION_LABELS[f] ?? f);
}

/**
 * Kalemler adımında gösterilecek mesajlar (bilgi / uyarı ayrı).
 *
 * `itemsSumOverride`: kullanıcının GÜNCEL kalem toplamı (kuruş). Elle düzeltme sonrası
 * geçilirse uyarılar OCR'ın ilk okuduğu tutara değil, ekrandaki güncel kalemlere göre
 * hesaplanır → kullanıcı tutarı düzeltince uyarı anında güncellenir/kaybolur.
 */
export function buildReceiptValidationLines(
  analysis: AnalyzedReceipt,
  currency: string,
  itemsSumOverride?: number,
): ReceiptValidationMessages {
  const info: string[] = [];
  const warnings: string[] = [];
  const c = analysis.receipt.charges;
  const itemsSumCents = itemsSumOverride ?? analysis.arithmetic.itemsSumCents;
  const aligned = itemsAlignWithReceiptTotal(analysis, itemsSumOverride);

  const itemsMismatch = itemsVsTotalMessage(analysis, currency, itemsSumOverride);
  if (itemsMismatch) {
    warnings.push(itemsMismatch);
  } else {
    info.push(...receiptInfoLines(c, currency));
  }

  if (
    !aligned &&
    itemsSumCents !== analysis.arithmetic.declaredSubtotalCents &&
    analysis.arithmetic.declaredSubtotalCents > 0
  ) {
    warnings.push(
      `Kalemler toplamı (${money(currency, itemsSumCents)}) fişteki ara toplamdan (${money(currency, analysis.arithmetic.declaredSubtotalCents)}) farklı.`,
    );
  }

  for (const flag of analysis.flags) {
    if (flag.reason === "unbalanced_total") continue;
    if (flag.reason === "low_confidence") continue;
    const target = flag.message;
    if (info.includes(target) || warnings.includes(target)) continue;
    warnings.push(target);
  }

  for (const w of analysis.warnings) {
    if (!info.includes(w) && !warnings.includes(w)) warnings.push(w);
  }

  const confirmLabels = confirmationFieldLabels(
    analysis.needsConfirmation.filter((f) => f !== "total" || !aligned),
  );
  if (confirmLabels.length > 0) {
    warnings.push(`Kontrol et: ${confirmLabels.join(", ")}.`);
  }

  return { info, warnings };
}

/** Fişteki beyan edilen toplam (özet satırı için). */
export function declaredTotalLabel(
  analysis: AnalyzedReceipt,
  currency: string,
): string | null {
  if (analysis.arithmetic.declaredTotalCents <= 0) return null;
  return `Fiş toplamı: ${currency}${formatCents(analysis.arithmetic.declaredTotalCents)}`;
}
