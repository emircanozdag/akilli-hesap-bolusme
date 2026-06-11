import { describe, it, expect } from "vitest";
import { computeSplit } from "../src/split.js";
import { sumCents } from "../src/money.js";
import type { SplitInput } from "../src/types.js";

describe("computeSplit — DESIGN.md §4 doğrulanmış örnek", () => {
  // 3 kişi, 3 kalem + %10 bahşiş (KDV dahil).
  // Steak 25.00 → Ali, Salata 8.00 → Ayşe, Paylaşılan meze 10.00 → 3 kişi.
  // Beklenen: Ali 31.18 + Ayşe 12.46 + Mehmet 3.66 = 47.30 TL.
  const input: SplitInput = {
    receipt: {
      lineItems: [
        { id: "steak", name: "Steak", qty: 1, totalPriceCents: 2500 },
        { id: "salata", name: "Salata", qty: 1, totalPriceCents: 800 },
        { id: "meze", name: "Paylaşılan meze", qty: 1, totalPriceCents: 1000 },
      ],
      charges: {
        subtotalCents: 4300,
        taxCents: 0,
        serviceChargeCents: 0,
        discountCents: 0,
        tipCents: 430,
        totalCents: 4730,
        taxIncludedInItems: true,
      },
    },
    people: [
      { id: "ali", name: "Ali" },
      { id: "ayse", name: "Ayşe" },
      { id: "mehmet", name: "Mehmet" },
    ],
    assignments: [
      { lineItemId: "steak", personId: "ali" },
      { lineItemId: "salata", personId: "ayse" },
      { lineItemId: "meze", personId: "ali" },
      { lineItemId: "meze", personId: "ayse" },
      { lineItemId: "meze", personId: "mehmet" },
    ],
    tipMode: "proportional",
  };

  it("kişi başı tutarları belgedeki örneğe birebir eşittir", () => {
    const r = computeSplit(input);
    const byId = Object.fromEntries(r.perPerson.map((s) => [s.personId, s]));

    expect(byId.ali).toMatchObject({ itemsCents: 2834, taxCents: 0, tipCents: 284, totalCents: 3118 });
    expect(byId.ayse).toMatchObject({ itemsCents: 1133, taxCents: 0, tipCents: 113, totalCents: 1246 });
    expect(byId.mehmet).toMatchObject({ itemsCents: 333, taxCents: 0, tipCents: 33, totalCents: 366 });
  });

  it("toplam fişe birebir eşit (kuruş hatası yok)", () => {
    const r = computeSplit(input);
    expect(r.totalCents).toBe(4730);
    expect(sumCents(r.perPerson.map((s) => s.totalCents))).toBe(4730);
  });
});

describe("computeSplit — vergi katmanı (KDV dahil değil)", () => {
  it("vergiyi kalem tabanına oransal dağıtır", () => {
    const r = computeSplit({
      receipt: {
        lineItems: [
          { id: "a", name: "A", qty: 1, totalPriceCents: 3000 },
          { id: "b", name: "B", qty: 1, totalPriceCents: 1000 },
        ],
        charges: {
          subtotalCents: 4000,
          taxCents: 400, // %10
          serviceChargeCents: 0,
          discountCents: 0,
          tipCents: 0,
          totalCents: 4400,
          taxIncludedInItems: false,
        },
      },
      people: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
      ],
      assignments: [
        { lineItemId: "a", personId: "p1" },
        { lineItemId: "b", personId: "p2" },
      ],
    });
    const byId = Object.fromEntries(r.perPerson.map((s) => [s.personId, s]));
    expect(byId.p1).toMatchObject({ itemsCents: 3000, taxCents: 300, totalCents: 3300 });
    expect(byId.p2).toMatchObject({ itemsCents: 1000, taxCents: 100, totalCents: 1100 });
    expect(r.totalCents).toBe(4400);
  });
});

describe("computeSplit — kenar durumları (DESIGN.md §4)", () => {
  const baseReceipt = {
    lineItems: [{ id: "x", name: "X", qty: 1, totalPriceCents: 1000 }],
    charges: {
      subtotalCents: 1000,
      taxCents: 0,
      serviceChargeCents: 0,
      discountCents: 0,
      tipCents: 0,
      totalCents: 1000,
      taxIncludedInItems: true,
    },
  };

  it("atanmamış kalem varsayılan olarak hata verir", () => {
    expect(() =>
      computeSplit({
        receipt: baseReceipt,
        people: [{ id: "p1", name: "P1" }],
        assignments: [],
      }),
    ).toThrow(/Atanmamış kalem/);
  });

  it("unassignedStrategy:equal ile herkese eşit böler + uyarı verir", () => {
    const r = computeSplit({
      receipt: baseReceipt,
      people: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
      ],
      assignments: [],
      unassignedStrategy: "equal",
    });
    expect(r.totalCents).toBe(1000);
    expect(r.perPerson.map((s) => s.totalCents)).toEqual([500, 500]);
    expect(r.warnings.some((w) => w.code === "UNASSIGNED_ITEMS")).toBe(true);
  });

  it("indirimi oransal düşer", () => {
    const r = computeSplit({
      receipt: {
        lineItems: [
          { id: "a", name: "A", qty: 1, totalPriceCents: 3000 },
          { id: "b", name: "B", qty: 1, totalPriceCents: 1000 },
        ],
        charges: {
          subtotalCents: 4000,
          taxCents: 0,
          serviceChargeCents: 0,
          discountCents: 400, // %10 indirim
          tipCents: 0,
          totalCents: 3600,
          taxIncludedInItems: true,
        },
      },
      people: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
      ],
      assignments: [
        { lineItemId: "a", personId: "p1" },
        { lineItemId: "b", personId: "p2" },
      ],
    });
    const byId = Object.fromEntries(r.perPerson.map((s) => [s.personId, s]));
    expect(byId.p1.itemsCents).toBe(2700);
    expect(byId.p2.itemsCents).toBe(900);
    expect(r.totalCents).toBe(3600);
  });

  it("kalemler toplamı ara toplamla uyuşmazsa uyarır", () => {
    const r = computeSplit({
      receipt: {
        lineItems: [{ id: "x", name: "X", qty: 1, totalPriceCents: 1000 }],
        charges: { ...baseReceipt.charges, subtotalCents: 1200, totalCents: 1200 },
      },
      people: [{ id: "p1", name: "P1" }],
      assignments: [{ lineItemId: "x", personId: "p1" }],
    });
    expect(r.warnings.some((w) => w.code === "ITEMS_SUM_MISMATCH")).toBe(true);
  });

  it("boş kişi listesini reddeder (sıfıra bölme)", () => {
    expect(() =>
      computeSplit({ receipt: baseReceipt, people: [], assignments: [] }),
    ).toThrow();
  });

  it("paylaşılan kalemde ağırlıklı bölüşüm (biri 2 porsiyon)", () => {
    const r = computeSplit({
      receipt: {
        lineItems: [{ id: "pizza", name: "Pizza", qty: 1, totalPriceCents: 900 }],
        charges: { ...baseReceipt.charges, subtotalCents: 900, totalCents: 900 },
      },
      people: [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
      ],
      assignments: [
        { lineItemId: "pizza", personId: "p1", weight: 2 },
        { lineItemId: "pizza", personId: "p2", weight: 1 },
      ],
    });
    const byId = Object.fromEntries(r.perPerson.map((s) => [s.personId, s]));
    expect(byId.p1.itemsCents).toBe(600);
    expect(byId.p2.itemsCents).toBe(300);
    expect(r.totalCents).toBe(900);
  });
});

describe("computeSplit — invariant (toplam korunur)", () => {
  it("rastgele senaryolarda Σ kişi payı = dağıtılan toplam", () => {
    let seed = 12345;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };

    for (let t = 0; t < 200; t++) {
      const nPeople = 1 + rand(5);
      const nItems = 1 + rand(6);
      const people = Array.from({ length: nPeople }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
      const lineItems = Array.from({ length: nItems }, (_, i) => ({
        id: `i${i}`,
        name: `I${i}`,
        qty: 1,
        totalPriceCents: 1 + rand(5000),
      }));
      const assignments = lineItems.flatMap((item) => {
        const sharers = 1 + rand(nPeople);
        return Array.from({ length: sharers }, (_, k) => ({
          lineItemId: item.id,
          personId: `p${k}`,
        }));
      });
      const itemsSum = sumCents(lineItems.map((i) => i.totalPriceCents));
      const taxCents = rand(800);
      const tipCents = rand(800);

      const r = computeSplit({
        receipt: {
          lineItems,
          charges: {
            subtotalCents: itemsSum,
            taxCents,
            serviceChargeCents: 0,
            discountCents: 0,
            tipCents,
            totalCents: itemsSum + taxCents + tipCents,
            taxIncludedInItems: false,
          },
        },
        people,
        assignments,
      });

      const expected = itemsSum + taxCents + tipCents;
      expect(sumCents(r.perPerson.map((s) => s.totalCents))).toBe(expected);
      expect(r.totalCents).toBe(expected);
    }
  });
});
