import { describe, expect, it } from "vitest";
import type { ComputedSplit, PersonRow } from "../src/logic";
import { buildShareText, formatShareDate } from "../src/share-summary";

const PEOPLE: PersonRow[] = [
  { id: "p1", name: "Ali", color: "#f00" },
  { id: "p2", name: "Ayşe", color: "#0f0" },
];

function mockComputed(overrides: Partial<ComputedSplit> = {}): ComputedSplit {
  return {
    subtotalCents: 10000,
    taxCents: 0,
    tipCents: 0,
    discountCents: 0,
    serviceChargeCents: 0,
    grandTotalCents: 10000,
    result: {
      totalCents: 10000,
      warnings: [],
      perPerson: [
        { personId: "p1", itemsCents: 5000, taxCents: 0, tipCents: 0, totalCents: 5000 },
        { personId: "p2", itemsCents: 5000, taxCents: 0, tipCents: 0, totalCents: 5000 },
      ],
    },
    ...overrides,
  };
}

describe("formatShareDate", () => {
  it("ISO tarihi DD.MM.YYYY biçimine çevirir", () => {
    expect(formatShareDate("2025-06-15")).toBe("15.06.2025");
  });

  it("tanınmayan metni olduğu gibi döndürür", () => {
    expect(formatShareDate("15/06/2025")).toBe("15/06/2025");
  });
});

describe("buildShareText", () => {
  it("merchant ve date yokken temel başlık üretir", () => {
    const text = buildShareText({
      currency: "₺",
      computed: mockComputed(),
      people: PEOPLE,
    });
    expect(text).toContain("SplitTab");
    expect(text).toContain("Kalemler      ₺100.00");
    expect(text).toContain("Toplam        ₺100.00");
    expect(text).toContain("Ali: ₺50.00");
    expect(text).toContain("Ayşe: ₺50.00");
    expect(text).not.toContain("(eşit bölündü)");
  });

  it("merchant ve date başlığa eklenir", () => {
    const text = buildShareText({
      currency: "$",
      merchant: "Perkins Family Restaurant",
      date: "2025-03-10",
      computed: mockComputed(),
      people: PEOPLE,
    });
    expect(text).toContain("Perkins Family Restaurant");
    expect(text).toContain("10.03.2025");
  });

  it("KDV dahil fişte servis satırı gösterilir, KDV ve bahşiş yok", () => {
    const text = buildShareText({
      currency: "$",
      computed: mockComputed({
        subtotalCents: 158267,
        serviceChargeCents: 23740,
        grandTotalCents: 182007,
        result: {
          totalCents: 182007,
          warnings: [],
          perPerson: [
            {
              personId: "p1",
              itemsCents: 79133,
              taxCents: 0,
              tipCents: 11870,
              totalCents: 91003,
            },
            {
              personId: "p2",
              itemsCents: 79134,
              taxCents: 0,
              tipCents: 11870,
              totalCents: 91004,
            },
          ],
        },
      }),
      people: PEOPLE,
    });
    expect(text).toContain("Servis        $237.40");
    expect(text).not.toMatch(/^KDV           /m);
    expect(text).not.toMatch(/^Bahşiş        /m);
    expect(text).toContain("Ali: $910.03 (Servis/Bahşiş 118.70)");
  });

  it("KDV ayrı + bahşiş + indirim tüm kırılım satırlarını gösterir", () => {
    const text = buildShareText({
      currency: "$",
      computed: mockComputed({
        subtotalCents: 10000,
        discountCents: 500,
        taxCents: 900,
        serviceChargeCents: 0,
        tipCents: 1500,
        grandTotalCents: 11900,
        result: {
          totalCents: 11900,
          warnings: [],
          perPerson: [
            {
              personId: "p1",
              itemsCents: 4750,
              taxCents: 450,
              tipCents: 750,
              totalCents: 5950,
            },
            {
              personId: "p2",
              itemsCents: 4750,
              taxCents: 450,
              tipCents: 750,
              totalCents: 5950,
            },
          ],
        },
      }),
      people: PEOPLE,
    });
    expect(text).toContain("İndirim       −$5.00");
    expect(text).toContain("KDV           $9.00");
    expect(text).toContain("Bahşiş        $15.00");
    expect(text).toContain("Toplam        $119.00");
    expect(text).toContain("KDV 4.50 · Servis/Bahşiş 7.50");
  });

  it("eşit bölüşümde başlık notu eklenir", () => {
    const text = buildShareText({
      currency: "₺",
      computed: mockComputed(),
      people: PEOPLE,
      equalSplit: true,
    });
    expect(text).toContain("(eşit bölündü)");
  });
});
