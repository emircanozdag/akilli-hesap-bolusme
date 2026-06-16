/** Akıllı atama girdisi — heuristik ve LLM ortak. */
export interface SuggestItem {
  id: string;
  name: string;
  qty: number;
}

export interface SuggestPerson {
  id: string;
  name: string;
}

export interface SuggestInput {
  items: SuggestItem[];
  people: SuggestPerson[];
  hint?: string;
  locale?: string;
}

/** Ham atama satırı — LLM kişi adı döndürür (ID değil). */
export interface RawAssignmentRow {
  lineItemId: string;
  personNames: string[];
  weights?: number[];
}

/** LLM / heuristik ham çıktısı (normalize öncesi). */
export interface RawSuggestion {
  assignments: RawAssignmentRow[];
  confidence: number;
  notes?: string;
}

export type AssignmentWeights = Record<string, Record<string, number>>;

export type SuggestSource = "heuristic" | "llm";

/** normalizeAssignments sonrası — mobil SplitState.assignments ile uyumlu. */
export interface SuggestResult {
  assignments: AssignmentWeights;
  source: SuggestSource;
  confidence: number;
  partial: boolean;
  droppedItems?: string[];
  notes?: string;
}
