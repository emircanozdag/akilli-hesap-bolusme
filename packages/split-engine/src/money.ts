/**
 * Para birimi yardımcıları — DESIGN.md §4 "Altın kural".
 *
 * Her parasal değer KURUŞ cinsinden tam sayı (integer) olarak tutulur.
 * Float aritmetiği YASAK: 19,99 → 1999. Hesap tam sayıyla yapılır,
 * yalnızca ekrana basarken 100'e bölünür.
 */

/** Kuruş cinsinden tam sayı tutar (ör. 1999 = 19,99). */
export type Cents = number;

export function assertCents(value: Cents, label = "amount"): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} kuruş (tam sayı) olmalı, alınan: ${value}`);
  }
}

/**
 * "19.99", "19,99", 19.99 gibi girdileri güvenle kuruşa çevirir.
 * Float yuvarlama hatasına karşı string üzerinden ayrıştırır.
 */
export function toCents(amount: string | number): Cents {
  const normalized =
    typeof amount === "number" ? amount.toString() : amount.trim().replace(",", ".");

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new RangeError(`Geçersiz tutar: ${amount}`);
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "00").slice(0, 2);
  const cents = Number(whole) * 100 + Number(fracPadded);

  return negative ? -cents : cents;
}

/** Kuruşu görüntüleme dizisine çevirir: 1999 → "19.99". */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Bir dizi kuruş değerinin güvenli toplamı. */
export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}
