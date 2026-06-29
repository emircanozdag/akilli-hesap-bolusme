import { describe, expect, it } from "vitest";
import {
  getItemAssignmentMeta,
  validateStep3Assignments,
} from "../src/assignment-validation";
import type { SplitState } from "../src/logic";

function baseState(overrides: Partial<SplitState> = {}): SplitState {
  return {
    currency: "₺",
    items: [],
    people: [
      { id: "p1", name: "Ben", color: "#6c8bff" },
      { id: "p2", name: "Arkadaş", color: "#3ecf8e" },
    ],
    assignments: {},
    discountCents: 0,
    serviceChargeCents: 0,
    tax: { included: true, value: "" },
    tip: { mode: "proportional", isPercent: true, value: "" },
    ...overrides,
  };
}

describe("getItemAssignmentMeta", () => {
  it("3 adet, 2 kişi pay 1+1 → kalan 1, needsQtyAttention", () => {
    const meta = getItemAssignmentMeta(3, { p1: 1, p2: 1 });
    expect(meta.remaining).toBe(1);
    expect(meta.needsQtyAttention).toBe(true);
    expect(meta.showWeightSteppers).toBe(true);
  });

  it("3 adet, pay 1+2 → tam dağıtım", () => {
    const meta = getItemAssignmentMeta(3, { p1: 1, p2: 2 });
    expect(meta.remaining).toBe(0);
    expect(meta.needsQtyAttention).toBe(false);
    expect(meta.qtyFullyAllocated).toBe(true);
  });

  it("1 adet → cap uygulanmaz, pay sayacı gösterilmez", () => {
    const meta = getItemAssignmentMeta(1, { p1: 1, p2: 1 });
    expect(meta.capEnforced).toBe(false);
    expect(meta.needsQtyAttention).toBe(false);
    expect(meta.showWeightSteppers).toBe(false);
  });
});

describe("validateStep3Assignments", () => {
  it("3× çay 1+1 → blocked, eksik adet", () => {
    const state = baseState({
      items: [{ id: "i1", name: "Yeşil Çay", price: "90,00", qty: 3 }],
      assignments: { i1: { p1: 1, p2: 1 } },
    });
    const v = validateStep3Assignments(state);
    expect(v.blocked).toBe(true);
    expect(v.incompleteQty).toHaveLength(1);
    expect(v.incompleteQty[0]?.remaining).toBe(1);
    expect(v.needsUnassignedConfirm).toBe(false);
    expect(v.blockMessage).toContain("Yeşil Çay");
  });

  it("3× çay 1+2 → blocked değil", () => {
    const state = baseState({
      items: [{ id: "i1", name: "Yeşil Çay", price: "90,00", qty: 3 }],
      assignments: { i1: { p1: 1, p2: 2 } },
    });
    const v = validateStep3Assignments(state);
    expect(v.blocked).toBe(false);
    expect(v.incompleteQty).toHaveLength(0);
    expect(v.footerHint).toBeNull();
  });

  it("atanmamış kalem → onay gerekir, blok yok", () => {
    const state = baseState({
      items: [
        { id: "i1", name: "Su", price: "10,00", qty: 1 },
        { id: "i2", name: "Meze", price: "50,00", qty: 1 },
      ],
      assignments: { i1: { p1: 1 } },
    });
    const v = validateStep3Assignments(state);
    expect(v.blocked).toBe(false);
    expect(v.unassigned).toHaveLength(1);
    expect(v.unassigned[0]?.itemName).toBe("Meze");
    expect(v.needsUnassignedConfirm).toBe(true);
    expect(v.footerHint).toContain("1 kalem atanmadı");
  });

  it("tüm kalemler atanmış ve adet tam → serbest", () => {
    const state = baseState({
      items: [{ id: "i1", name: "Çay", price: "90,00", qty: 3 }],
      assignments: { i1: { p1: 1, p2: 2 } },
    });
    const v = validateStep3Assignments(state);
    expect(v.blocked).toBe(false);
    expect(v.needsUnassignedConfirm).toBe(false);
    expect(v.footerHint).toBeNull();
  });

  it("eksik adet öncelikli footer (atanmamış + eksik birlikte)", () => {
    const state = baseState({
      items: [
        { id: "i1", name: "Çay", price: "90,00", qty: 3 },
        { id: "i2", name: "Su", price: "10,00", qty: 1 },
      ],
      assignments: { i1: { p1: 1, p2: 1 } },
    });
    const v = validateStep3Assignments(state);
    expect(v.blocked).toBe(true);
    expect(v.unassigned).toHaveLength(1);
    expect(v.footerHint).toContain("adet");
  });
});
