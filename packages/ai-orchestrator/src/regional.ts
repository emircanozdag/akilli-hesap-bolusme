/**
 * Bölgesel bahşiş motoru — DESIGN.md §5/§7.
 * AI fişten bunu üretmez; locale/para birimine göre DETERMİNİSTİK enjekte ederiz.
 * Uluslararası konumlandırmanın çekirdeği (her ülkenin bahşiş kültürü).
 */
import type { Regional } from "./types.js";

interface RegionRule {
  tippingNorm: Regional["tippingNorm"];
  suggestedTipPercentages: number[];
  note?: string;
}

const BY_COUNTRY: Record<string, RegionRule> = {
  US: { tippingNorm: "expected", suggestedTipPercentages: [15, 18, 20], note: "Bahşiş beklenir." },
  CA: { tippingNorm: "expected", suggestedTipPercentages: [15, 18, 20] },
  TR: { tippingNorm: "optional", suggestedTipPercentages: [5, 10], note: "Bahşiş isteğe bağlı." },
  GB: { tippingNorm: "optional", suggestedTipPercentages: [10, 12.5] },
  DE: { tippingNorm: "included", suggestedTipPercentages: [5, 10], note: "Servis genelde dahil." },
  FR: { tippingNorm: "included", suggestedTipPercentages: [5, 10], note: "Service compris." },
  IT: { tippingNorm: "included", suggestedTipPercentages: [5, 10] },
  ES: { tippingNorm: "included", suggestedTipPercentages: [5, 10] },
  NL: { tippingNorm: "included", suggestedTipPercentages: [5, 10] },
  JP: { tippingNorm: "none", suggestedTipPercentages: [], note: "Bahşiş adeti yoktur." },
  KR: { tippingNorm: "none", suggestedTipPercentages: [] },
  CN: { tippingNorm: "none", suggestedTipPercentages: [] },
};

const BY_CURRENCY: Record<string, string> = {
  USD: "US",
  TRY: "TR",
  GBP: "GB",
  EUR: "DE",
  JPY: "JP",
  KRW: "KR",
  CNY: "CN",
};

const DEFAULT_RULE: RegionRule = {
  tippingNorm: "optional",
  suggestedTipPercentages: [10],
};

/** "tr-TR" → "TR". Geçersizse undefined. */
export function countryFromLocale(locale?: string): string | undefined {
  if (!locale) return undefined;
  const parts = locale.replace("_", "-").split("-");
  const region = parts[1];
  return region && region.length === 2 ? region.toUpperCase() : undefined;
}

/**
 * Locale → para birimi → varsayılan sırasıyla ülkeyi çözer ve bölgesel kuralı verir.
 */
export function resolveRegional(opts: {
  locale?: string;
  currency?: string;
  hintLocale?: string;
}): Regional {
  const country =
    countryFromLocale(opts.locale) ??
    countryFromLocale(opts.hintLocale) ??
    (opts.currency ? BY_CURRENCY[opts.currency.toUpperCase()] : undefined);

  const rule = (country && BY_COUNTRY[country]) || DEFAULT_RULE;

  return {
    ...(country ? { country } : {}),
    tippingNorm: rule.tippingNorm,
    suggestedTipPercentages: rule.suggestedTipPercentages,
    ...(rule.note ? { note: rule.note } : {}),
  };
}
