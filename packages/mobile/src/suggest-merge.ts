/**
 * LLM önerisini mevcut atamalara birleştirir.
 * Heuristik ve kullanıcı düzenlemeleri korunur.
 */
import type { AssignmentWeights, SuggestResult } from "@ahb/ai-orchestrator";

export function hasAssignment(weights: Record<string, number> | undefined): boolean {
  if (!weights) return false;
  return Object.values(weights).some((w) => w > 0);
}

export interface MergeLlmOptions {
  current: AssignmentWeights;
  llm: SuggestResult;
  /** Heuristikle doldurulan kalem id'leri — LLM bunların üzerine yazamaz. */
  heuristicItems: ReadonlySet<string>;
  /** Kullanıcının elle dokunduğu kalem id'leri. */
  userEditedItems: ReadonlySet<string>;
}

/** LLM önerisini uygular; hangi kalemlerin güncellendiğini döndürür. */
export function mergeLlmSuggestion(opts: MergeLlmOptions): {
  assignments: AssignmentWeights;
  appliedItemIds: string[];
} {
  const next: AssignmentWeights = { ...opts.current };
  const appliedItemIds: string[] = [];

  for (const [itemId, llmWeights] of Object.entries(opts.llm.assignments)) {
    if (opts.heuristicItems.has(itemId)) continue;
    if (opts.userEditedItems.has(itemId)) continue;
    if (hasAssignment(next[itemId])) continue;

    next[itemId] = { ...llmWeights };
    appliedItemIds.push(itemId);
  }

  return { assignments: next, appliedItemIds };
}

/** Atama map'inin derin kopyası. */
export function cloneAssignments(
  src: AssignmentWeights,
): AssignmentWeights {
  const out: AssignmentWeights = {};
  for (const [itemId, weights] of Object.entries(src)) {
    out[itemId] = { ...weights };
  }
  return out;
}

/** Heuristik sonucundan doldurulan kalem id kümesi. */
export function heuristicItemIds(heuristic: SuggestResult): Set<string> {
  return new Set(Object.keys(heuristic.assignments));
}
