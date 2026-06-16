import { describe, expect, it } from "vitest";
import type { SuggestResult } from "@ahb/ai-orchestrator";
import { cloneAssignments, mergeLlmSuggestion } from "../src/suggest-merge";

describe("mergeLlmSuggestion", () => {
  it("boş kalemlere LLM atamasını uygular", () => {
    const llm: SuggestResult = {
      source: "llm",
      confidence: 0.9,
      partial: false,
      assignments: {
        i2: { p1: 1 },
      },
    };
    const result = mergeLlmSuggestion({
      current: { i1: { p1: 1, p2: 1 } },
      llm,
      heuristicItems: new Set(["i1"]),
      userEditedItems: new Set(),
    });
    expect(result.assignments.i1).toEqual({ p1: 1, p2: 1 });
    expect(result.assignments.i2).toEqual({ p1: 1 });
    expect(result.appliedItemIds).toEqual(["i2"]);
  });

  it("heuristik kalemlerin üzerine yazmaz", () => {
    const llm: SuggestResult = {
      source: "llm",
      confidence: 0.9,
      partial: false,
      assignments: {
        i1: { p2: 1 },
      },
    };
    const result = mergeLlmSuggestion({
      current: { i1: { p1: 1, p2: 1, p3: 1 } },
      llm,
      heuristicItems: new Set(["i1"]),
      userEditedItems: new Set(),
    });
    expect(result.assignments.i1).toEqual({ p1: 1, p2: 1, p3: 1 });
    expect(result.appliedItemIds).toHaveLength(0);
  });

  it("kullanıcı düzenlediği kalemi korur", () => {
    const llm: SuggestResult = {
      source: "llm",
      confidence: 0.9,
      partial: false,
      assignments: {
        i2: { p2: 1 },
      },
    };
    const result = mergeLlmSuggestion({
      current: { i2: { p1: 1 } },
      llm,
      heuristicItems: new Set(),
      userEditedItems: new Set(["i2"]),
    });
    expect(result.assignments.i2).toEqual({ p1: 1 });
    expect(result.appliedItemIds).toHaveLength(0);
  });

  it("mevcut ataması olan kaleme LLM uygulamaz", () => {
    const llm: SuggestResult = {
      source: "llm",
      confidence: 0.9,
      partial: false,
      assignments: {
        i1: { p2: 1 },
      },
    };
    const result = mergeLlmSuggestion({
      current: { i1: { p1: 1 } },
      llm,
      heuristicItems: new Set(),
      userEditedItems: new Set(),
    });
    expect(result.assignments.i1).toEqual({ p1: 1 });
  });
});

describe("cloneAssignments", () => {
  it("derin kopya üretir", () => {
    const src = { i1: { p1: 2 } };
    const copy = cloneAssignments(src);
    copy.i1!.p1 = 5;
    expect(src.i1.p1).toBe(2);
  });
});
