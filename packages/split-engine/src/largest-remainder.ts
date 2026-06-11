/**
 * En Büyük Kalan Yöntemi — DESIGN.md §4 "Küsürat".
 *
 * Bir kuruş tutarını ağırlıklara göre paylara böler ve TOPLAMI KORUR:
 * parçaların toplamı her zaman girdiye birebir eşittir (kuruş kaybı/fazlası yok).
 *
 *   1. taban_i = floor(tutar * w_i / Σw)
 *   2. kalan = tutar - Σ taban_i   (dağıtılacak artan kuruşlar)
 *   3. Artan kuruşlar en büyük ondalık küsürata sahip paylara 1'er verilir.
 *   4. Eşitlik bozulursa düşük indeks (deterministik sıra) kazanır.
 */

import { assertCents, type Cents } from "./money.js";

export interface LargestRemainderOptions {
  /**
   * Artan kuruşların dağıtımına başlanacak indeks ofseti.
   * Kalem bölüşmesinde dönüşümlü (rotating) adalet için kullanılır;
   * oransal katmanlarda 0 bırakılır.
   */
  rotationOffset?: number;
}

/**
 * `amount` kuruşunu `weights` ağırlıklarına göre böler.
 * Dönen dizinin uzunluğu `weights` ile aynıdır ve toplamı tam `amount`'tır.
 */
export function distributeByWeights(
  amount: Cents,
  weights: readonly number[],
  options: LargestRemainderOptions = {},
): Cents[] {
  assertCents(amount, "amount");

  const n = weights.length;
  if (n === 0) {
    if (amount !== 0) {
      throw new RangeError("Dağıtılacak alıcı yok ama tutar sıfır değil.");
    }
    return [];
  }

  if (weights.some((w) => w < 0)) {
    throw new RangeError("Ağırlıklar negatif olamaz.");
  }

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight <= 0) {
    throw new RangeError("Ağırlık toplamı sıfır; bölme yapılamaz (sıfıra bölme koruması).");
  }

  // Adım 1: taban paylar + ondalık küsürat (negatif tutarlarda da çalışır).
  const base: Cents[] = new Array(n).fill(0);
  const remainderFraction: { index: number; frac: number }[] = [];

  for (let i = 0; i < n; i++) {
    const exact = (amount * weights[i]!) / totalWeight;
    const floored = Math.floor(exact);
    base[i] = floored;
    remainderFraction.push({ index: i, frac: exact - floored });
  }

  // Adım 2: dağıtılacak artan kuruş.
  let leftover = amount - base.reduce((acc, v) => acc + v, 0);

  // Adım 3-4: en büyük küsürat önce; eşitlikte düşük indeks.
  // Rotasyon ofseti, eşit küsüratlı kalem bölüşmelerinde adaleti döndürür.
  const offset = ((options.rotationOffset ?? 0) % n + n) % n;
  remainderFraction.sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    const ra = (a.index - offset + n) % n;
    const rb = (b.index - offset + n) % n;
    return ra - rb;
  });

  for (let k = 0; k < remainderFraction.length && leftover > 0; k++) {
    base[remainderFraction[k]!.index]! += 1;
    leftover -= 1;
  }

  return base;
}

/**
 * Bir tutarı `n` kişiye EŞİT böler (ağırlıklar 1). En büyük kalan ile toplam korunur.
 */
export function distributeEqually(
  amount: Cents,
  n: number,
  options: LargestRemainderOptions = {},
): Cents[] {
  if (n <= 0) {
    throw new RangeError("Kişi sayısı pozitif olmalı (sıfıra bölme koruması).");
  }
  return distributeByWeights(amount, new Array(n).fill(1), options);
}
