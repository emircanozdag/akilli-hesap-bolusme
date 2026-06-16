import { normalizeAssignments } from "./normalize.js";
import type { RawSuggestion, SuggestInput, SuggestResult } from "./types.js";

/** Paylaşımlı kalem adı kalıpları (TR + EN). */
const SHARED_ITEM_RE =
  /\b(meze|tabak|payla[sş]|ortak|nachos?|pizza|ekmek|salata|patates|combo|share|shared|platter|bread|fries|appetizer|starter)\b/i;

function buildSharedAssignment(people: SuggestInput["people"]): RawSuggestion["assignments"][0] {
  return {
    lineItemId: "",
    personNames: people.map((p) => p.name),
    weights: people.map(() => 1),
  };
}

/**
 * T0 — deterministik heuristik öneri (ağ yok, ~ms).
 * Belirsiz kalemler atlanır; LLM boşlukları doldurur.
 */
export function heuristicSuggest(input: SuggestInput): SuggestResult {
  const rows: RawSuggestion["assignments"] = [];

  if (input.people.length === 1) {
    const only = input.people[0]!;
    for (const item of input.items) {
      rows.push({
        lineItemId: item.id,
        personNames: [only.name],
        weights: [1],
      });
    }
  } else {
    for (const item of input.items) {
      const qty = Math.max(1, Math.round(item.qty));
      const name = item.name.trim();

      if (SHARED_ITEM_RE.test(name)) {
        rows.push({ ...buildSharedAssignment(input.people), lineItemId: item.id });
        continue;
      }

      if (qty >= 2 && qty === input.people.length) {
        rows.push({
          lineItemId: item.id,
          personNames: input.people.map((p) => p.name),
          weights: input.people.map(() => 1),
        });
      }
    }
  }

  const raw: RawSuggestion = {
    assignments: rows,
    confidence: rows.length > 0 ? 0.75 : 0.5,
    notes: rows.length > 0 ? "Heuristik öneri" : undefined,
  };

  return normalizeAssignments(raw, input, "heuristic");
}
