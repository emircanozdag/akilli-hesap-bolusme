import { describe, it, expect } from "vitest";
import { distributeByWeights, distributeEqually } from "../src/largest-remainder.js";
import { sumCents } from "../src/money.js";

describe("en büyük kalan yöntemi (DESIGN.md §4)", () => {
  it("eşit bölüşmede toplamı korur ve artan kuruşu düşük indekse verir", () => {
    // 1000 / 3 = 333.33 → 334, 333, 333
    expect(distributeEqually(1000, 3)).toEqual([334, 333, 333]);
  });

  it("artan kuruşu en büyük küsürata verir", () => {
    // 430 ağırlık [2834,1133,333] → küsürat .4/.3/.3 → ilk +1
    expect(distributeByWeights(430, [2834, 1133, 333])).toEqual([284, 113, 33]);
  });

  it("rotationOffset artan kuruşu döndürür", () => {
    expect(distributeEqually(100, 3, { rotationOffset: 0 })).toEqual([34, 33, 33]);
    expect(distributeEqually(100, 3, { rotationOffset: 1 })).toEqual([33, 34, 33]);
    expect(distributeEqually(100, 3, { rotationOffset: 2 })).toEqual([33, 33, 34]);
  });

  it("negatif tutarı (indirim) da toplamı koruyarak böler", () => {
    const parts = distributeByWeights(-100, [1, 1, 1]);
    expect(sumCents(parts)).toBe(-100);
  });

  it("ağırlıklı bölüşme (eşitsiz pay)", () => {
    // 300 ağırlık [2,1] → 200, 100
    expect(distributeByWeights(300, [2, 1])).toEqual([200, 100]);
  });

  it("sıfıra bölmeyi engeller", () => {
    expect(() => distributeEqually(100, 0)).toThrow();
    expect(() => distributeByWeights(100, [0, 0])).toThrow();
  });

  it("herhangi tutar/kişi için toplam her zaman korunur (property)", () => {
    for (let amount = 0; amount <= 1000; amount += 7) {
      for (let n = 1; n <= 9; n++) {
        expect(sumCents(distributeEqually(amount, n))).toBe(amount);
      }
    }
  });
});
