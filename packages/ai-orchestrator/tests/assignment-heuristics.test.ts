import { describe, expect, it } from "vitest";
import { heuristicSuggest } from "../src/assignment/heuristics.js";
import type { SuggestInput } from "../src/assignment/types.js";

const baseInput = (): SuggestInput => ({
  items: [
    { id: "i1", name: "Karışık Meze", qty: 1 },
    { id: "i2", name: "Izgara Köfte", qty: 1 },
    { id: "i3", name: "Cola", qty: 3 },
  ],
  people: [
    { id: "p1", name: "Ali" },
    { id: "p2", name: "Ayşe" },
    { id: "p3", name: "Mehmet" },
  ],
  locale: "tr-TR",
});

describe("heuristicSuggest", () => {
  it("tek kişide tüm kalemleri o kişiye atar", () => {
    const input: SuggestInput = {
      items: [{ id: "i1", name: "Steak", qty: 1 }],
      people: [{ id: "p1", name: "Ben" }],
    };
    const result = heuristicSuggest(input);
    expect(result.source).toBe("heuristic");
    expect(result.assignments.i1).toEqual({ p1: 1 });
  });

  it("paylaşımlı kalem adını tüm kişilere atar", () => {
    const result = heuristicSuggest(baseInput());
    expect(result.assignments.i1).toEqual({ p1: 1, p2: 1, p3: 1 });
  });

  it("qty === kişi sayısı ise kişi başı 1 adet atar", () => {
    const result = heuristicSuggest(baseInput());
    expect(result.assignments.i3).toEqual({ p1: 1, p2: 1, p3: 1 });
  });

  it("belirsiz kalemi atamaz", () => {
    const result = heuristicSuggest(baseInput());
    expect(result.assignments.i2).toBeUndefined();
  });

  it("İngilizce paylaşımlı isim (nachos)", () => {
    const input: SuggestInput = {
      items: [{ id: "n1", name: "Loaded Nachos", qty: 1 }],
      people: [
        { id: "p1", name: "A" },
        { id: "p2", name: "B" },
      ],
    };
    const result = heuristicSuggest(input);
    expect(result.assignments.n1).toEqual({ p1: 1, p2: 1 });
  });
});
