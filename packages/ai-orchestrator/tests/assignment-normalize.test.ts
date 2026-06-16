import { describe, expect, it } from "vitest";
import { normalizeAssignments, normalizePersonName } from "../src/assignment/normalize.js";
import type { SuggestInput } from "../src/assignment/types.js";

const input: SuggestInput = {
  items: [
    { id: "i1", name: "Su", qty: 3 },
    { id: "i2", name: "Steak", qty: 1 },
  ],
  people: [
    { id: "p1", name: "Ali" },
    { id: "p2", name: "Ayşe" },
    { id: "p3", name: "Mehmet" },
  ],
  locale: "tr-TR",
};

describe("normalizePersonName", () => {
  it("Türkçe locale ile küçük harfe çevirir", () => {
    expect(normalizePersonName("  Ayşe ", "tr-TR")).toBe("ayşe");
  });
});

describe("normalizeAssignments", () => {
  it("geçerli satırları id+weight map'e çevirir", () => {
    const result = normalizeAssignments(
      {
        assignments: [
          { lineItemId: "i2", personNames: ["Ali"], weights: [1] },
          {
            lineItemId: "i1",
            personNames: ["Ali", "Ayşe", "Mehmet"],
            weights: [1, 1, 1],
          },
        ],
        confidence: 0.9,
      },
      input,
      "llm",
    );
    expect(result.assignments.i2).toEqual({ p1: 1 });
    expect(result.assignments.i1).toEqual({ p1: 1, p2: 1, p3: 1 });
    expect(result.partial).toBe(false);
  });

  it("bilinmeyen lineItemId atılır", () => {
    const result = normalizeAssignments(
      {
        assignments: [{ lineItemId: "ghost", personNames: ["Ali"] }],
        confidence: 0.5,
      },
      input,
      "llm",
    );
    expect(Object.keys(result.assignments)).toHaveLength(0);
  });

  it("qty eksik dağıtımda kalemi drop eder (partial)", () => {
    const result = normalizeAssignments(
      {
        assignments: [
          {
            lineItemId: "i1",
            personNames: ["Ali", "Ayşe"],
            weights: [1, 1],
          },
        ],
        confidence: 0.7,
      },
      input,
      "llm",
    );
    expect(result.assignments.i1).toBeUndefined();
    expect(result.partial).toBe(true);
    expect(result.droppedItems).toContain("i1");
  });

  it("eşleşmeyen isim atılır", () => {
    const result = normalizeAssignments(
      {
        assignments: [{ lineItemId: "i2", personNames: ["Zeynep"] }],
        confidence: 0.5,
      },
      input,
      "llm",
    );
    expect(result.assignments.i2).toBeUndefined();
  });

  it("ağırlıkları qty'ye sığdırır", () => {
    const result = normalizeAssignments(
      {
        assignments: [
          {
            lineItemId: "i1",
            personNames: ["Ali", "Ayşe", "Mehmet"],
            weights: [2, 2, 2],
          },
        ],
        confidence: 0.8,
      },
      input,
      "llm",
    );
    const total = Object.values(result.assignments.i1 ?? {}).reduce((s, w) => s + w, 0);
    expect(total).toBeLessThanOrEqual(3);
  });
});
