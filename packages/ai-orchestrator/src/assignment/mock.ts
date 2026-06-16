import type { AssignmentProvider } from "./gemini-assign.js";
import type { SuggestInput } from "./types.js";

/** Test ve anahtarsız geliştirme için sabit atama yanıtı. */
export class MockAssignmentProvider implements AssignmentProvider {
  readonly name = "mock-assign";

  constructor(private readonly override?: unknown) {}

  async suggest(input: SuggestInput): Promise<unknown> {
    if (this.override !== undefined) return this.override;

    const shared = input.people.map((p) => p.name);
    const rows = input.items
      .filter((it) => /\b(meze|salata|pizza)\b/i.test(it.name))
      .map((it) => ({
        lineItemId: it.id,
        personNames: shared,
        weights: input.people.map(() => 1),
      }));

    if (input.people.length === 1) {
      return {
        assignments: input.items.map((it) => ({
          lineItemId: it.id,
          personNames: [input.people[0]!.name],
          weights: [1],
        })),
        confidence: 0.9,
      };
    }

    return {
      assignments: rows,
      confidence: rows.length > 0 ? 0.85 : 0.4,
      notes: "Mock atama",
    };
  }
}
