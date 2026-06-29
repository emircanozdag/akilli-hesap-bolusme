import { describe, expect, it } from "vitest";
import type { AnalyzedReceipt } from "@ahb/ai-orchestrator";
import {
  buildReceiptValidationLines,
  confirmationFieldLabels,
  declaredTotalLabel,
} from "../src/receipt-validation-ui";

function mockAnalysis(overrides: Partial<AnalyzedReceipt> = {}): AnalyzedReceipt {
  return {
    receipt: {
      lineItems: [],
      charges: {
        subtotalCents: 1000,
        taxCents: 0,
        serviceChargeCents: 0,
        discountCents: 0,
        tipCents: 0,
        totalCents: 1000,
        taxIncludedInItems: true,
      },
    },
    meta: { currency: "TRY", currencyConfidence: 1 },
    regional: { tippingNorm: "optional", suggestedTipPercentages: [10] },
    itemConfidence: {},
    flags: [],
    needsConfirmation: [],
    arithmetic: {
      itemsSumCents: 1000,
      declaredSubtotalCents: 1000,
      declaredTotalCents: 1000,
      balanced: true,
      discrepancyCents: 0,
    },
    warnings: [],
    cached: false,
    ...overrides,
  };
}

describe("confirmationFieldLabels", () => {
  it("teknik alan adlarını Türkçeleştirir", () => {
    expect(confirmationFieldLabels(["total", "currency"])).toEqual([
      "fiş toplamı",
      "para birimi",
    ]);
  });
});

describe("buildReceiptValidationLines", () => {
  it("dengesiz fişte kalemler–toplam farkını uyarır", () => {
    const { warnings } = buildReceiptValidationLines(
      mockAnalysis({
        arithmetic: {
          itemsSumCents: 1020,
          declaredSubtotalCents: 1000,
          declaredTotalCents: 1000,
          balanced: false,
          discrepancyCents: 20,
        },
        needsConfirmation: ["total"],
        flags: [
          {
            target: "total",
            reason: "unbalanced_total",
            message: "Toplam tutmuyor (fark 20 kuruş); kalemleri/toplamı kontrol et.",
          },
        ],
      }),
      "₺",
    );
    expect(warnings.some((l) => l.includes("fazla") && l.includes("0.20"))).toBe(true);
    expect(warnings.some((l) => l.includes("Kontrol et: fiş toplamı"))).toBe(true);
  });

  it("toplam kalemlerden fazlaysa eksik/servis olabilir deyip kalem kontrolü ister", () => {
    const { warnings } = buildReceiptValidationLines(
      mockAnalysis({
        receipt: {
          lineItems: [],
          charges: {
            subtotalCents: 158267,
            taxCents: 0,
            serviceChargeCents: 0,
            discountCents: 0,
            tipCents: 0,
            totalCents: 182007,
            taxIncludedInItems: true,
          },
        },
        arithmetic: {
          itemsSumCents: 158267,
          declaredSubtotalCents: 158267,
          declaredTotalCents: 182007,
          balanced: false,
          discrepancyCents: 23740,
        },
      }),
      "₺",
    );
    const msg = warnings.find((l) => l.includes("fazla"));
    expect(msg).toBeDefined();
    expect(msg).toContain("kalemleri kontrol et");
    expect(warnings.some((l) => l.includes("büyük olasılıkla"))).toBe(false);
  });

  it("kullanıcı kalemi düzeltip toplam tutunca uyarı kaybolur (itemsSumOverride)", () => {
    const analysis = mockAnalysis({
      receipt: {
        lineItems: [],
        charges: {
          subtotalCents: 9000,
          taxCents: 0,
          serviceChargeCents: 0,
          discountCents: 0,
          tipCents: 0,
          totalCents: 10000,
          taxIncludedInItems: true,
        },
      },
      arithmetic: {
        // OCR sushi'yi 90 okumuş → toplam 100'den 10 eksik görünüyor.
        itemsSumCents: 9000,
        declaredSubtotalCents: 9000,
        declaredTotalCents: 10000,
        balanced: false,
        discrepancyCents: 1000,
      },
    });

    // Düzeltmeden önce: uyarı var.
    const before = buildReceiptValidationLines(analysis, "₺");
    expect(before.warnings.some((l) => l.includes("fazla"))).toBe(true);

    // Kullanıcı kalemi 90 → 100 düzeltti; güncel toplam 10000 → uyarı kalkar.
    const after = buildReceiptValidationLines(analysis, "₺", 10000);
    expect(after.warnings.some((l) => l.includes("fazla"))).toBe(false);
    expect(after.warnings).toHaveLength(0);
  });

  it("dengeli fişte gereksiz mesaj üretmez", () => {
    const { info, warnings } = buildReceiptValidationLines(mockAnalysis(), "₺");
    expect(info).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("KDV dahil + servis bedelini ayrı bilgi satırları olarak gösterir", () => {
    const { info, warnings } = buildReceiptValidationLines(
      mockAnalysis({
        receipt: {
          lineItems: [],
          charges: {
            subtotalCents: 10000,
            taxCents: 1800,
            serviceChargeCents: 11750,
            discountCents: 0,
            tipCents: 0,
            totalCents: 21750,
            taxIncludedInItems: true,
          },
        },
        arithmetic: {
          itemsSumCents: 10000,
          declaredSubtotalCents: 10000,
          declaredTotalCents: 21750,
          balanced: true,
          discrepancyCents: 0,
        },
        needsConfirmation: [],
      }),
      "₺",
    );
    expect(warnings).toHaveLength(0);
    expect(info).toHaveLength(2);
    expect(info[0]).toMatch(/Fiyatlar KDV dahil/);
    expect(info[1]).toMatch(/Servis bedeli ₺117\.50/);
  });
});

describe("declaredTotalLabel", () => {
  it("fiş toplamını formatlar", () => {
    expect(declaredTotalLabel(mockAnalysis(), "₺")).toBe("Fiş toplamı: ₺10.00");
  });
});
