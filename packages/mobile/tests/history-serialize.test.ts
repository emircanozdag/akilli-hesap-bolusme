import { describe, expect, it } from "vitest";
import {
  buildSavedReceipt,
  isPayloadTooLarge,
  resolveTitle,
  shouldPersistState,
  snapshotForDirtyCheck,
} from "../src/history/serialize";
import type { SplitState } from "../src/logic";

function sampleState(): SplitState {
  return {
    currency: "₺",
    items: [{ id: "i1", name: "Kebap", price: "100,00", qty: 1 }],
    people: [
      { id: "p1", name: "Ali", color: "#6366f1" },
      { id: "p2", name: "Ayşe", color: "#ec4899" },
    ],
    assignments: { i1: { p1: 1 } },
    discountCents: 0,
    tax: { included: true, value: "" },
    tip: { mode: "proportional", isPercent: true, value: "" },
  };
}

describe("resolveTitle", () => {
  it("merchant varsa onu kullanır", () => {
    expect(
      resolveTitle(sampleState(), {
        meta: { merchant: "Perkins", currencyConfidence: 1 },
      } as Parameters<typeof resolveTitle>[1]),
    ).toBe("Perkins");
  });

  it("merchant yoksa ilk kalem adını kullanır", () => {
    expect(resolveTitle(sampleState(), null)).toBe("Kebap");
  });
});

describe("buildSavedReceipt", () => {
  it("grandTotalCents hesaplar", () => {
    const saved = buildSavedReceipt({
      id: "r1",
      state: sampleState(),
      lastStep: 2,
      equalSplit: false,
      status: "draft",
    });
    expect(saved.grandTotalCents).toBe(10000);
    expect(saved.personCount).toBe(2);
    expect(saved.itemCount).toBe(1);
    expect(saved.state.items[0]?.name).toBe("Kebap");
  });
});

describe("shouldPersistState", () => {
  it("kalemsiz oturumu kaydetmez", () => {
    const empty = { ...sampleState(), items: [] };
    expect(shouldPersistState(empty)).toBe(false);
    expect(shouldPersistState(sampleState())).toBe(true);
  });
});

describe("snapshotForDirtyCheck", () => {
  it("aynı durumda aynı snapshot üretir", () => {
    const state = sampleState();
    const a = snapshotForDirtyCheck({
      state,
      lastStep: 2,
      equalSplit: false,
      status: "draft",
    });
    const b = snapshotForDirtyCheck({
      state,
      lastStep: 2,
      equalSplit: false,
      status: "draft",
    });
    expect(a).toBe(b);
  });
});

describe("isPayloadTooLarge", () => {
  it("normal fiş boyutu sınırın altında", () => {
    expect(isPayloadTooLarge(sampleState())).toBe(false);
  });
});
