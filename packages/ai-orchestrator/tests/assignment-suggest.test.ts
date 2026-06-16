import { describe, expect, it } from "vitest";
import { MockAssignmentProvider } from "../src/assignment/mock.js";
import { suggestAssignments } from "../src/assignment/suggest.js";
import type { SuggestInput } from "../src/assignment/types.js";

describe("suggestAssignments", () => {
  it("MockProvider ile uçtan uca normalize eder", async () => {
    const input: SuggestInput = {
      items: [
        { id: "i1", name: "Meze Tabağı", qty: 1 },
        { id: "i2", name: "Burger", qty: 1 },
      ],
      people: [
        { id: "p1", name: "Ali" },
        { id: "p2", name: "Ayşe" },
      ],
    };
    const result = await suggestAssignments(input, new MockAssignmentProvider());
    expect(result.source).toBe("llm");
    expect(result.assignments.i1).toEqual({ p1: 1, p2: 1 });
  });

  it("tek kişide mock tüm kalemleri atar", async () => {
    const input: SuggestInput = {
      items: [{ id: "i1", name: "Pizza", qty: 1 }],
      people: [{ id: "p1", name: "Ben" }],
    };
    const result = await suggestAssignments(input, new MockAssignmentProvider());
    expect(result.assignments.i1).toEqual({ p1: 1 });
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});
