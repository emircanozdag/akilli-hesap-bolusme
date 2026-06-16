import { clampWeightsToQty, getItemAssignmentMeta } from "./clamp.js";
import { rawSuggestionSchema } from "./schema.js";
import type {
  AssignmentWeights,
  RawSuggestion,
  SuggestInput,
  SuggestResult,
  SuggestSource,
} from "./types.js";

export class AssignmentNormalizeError extends Error {
  override name = "AssignmentNormalizeError";
  constructor(
    message: string,
    readonly code: "SCHEMA_INVALID",
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

/** Türkçe/locale duyarlı isim normalizasyonu (eşleştirme için). */
export function normalizePersonName(name: string, locale = "tr-TR"): string {
  return name.trim().toLocaleLowerCase(locale);
}

/** Girdideki kişi listesinden isim → id eşlemesi. */
function buildNameIndex(
  people: SuggestInput["people"],
  locale?: string,
): Map<string, string> {
  const loc = locale ?? "tr-TR";
  const index = new Map<string, string>();
  for (const p of people) {
    const key = normalizePersonName(p.name, loc);
    if (!index.has(key)) index.set(key, p.id);
  }
  return index;
}

function resolvePersonIds(
  names: string[],
  nameIndex: Map<string, string>,
  locale?: string,
): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const id = nameIndex.get(normalizePersonName(name, locale ?? "tr-TR"));
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Ham öneriyi mobil SplitState.assignments formatına çevirir.
 * Geçersiz satırlar atılır; qty kısıtı ihlali olan kalemler drop edilir (partial).
 */
export function normalizeAssignments(
  raw: unknown,
  input: SuggestInput,
  source: SuggestSource,
): SuggestResult {
  const parsed = rawSuggestionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AssignmentNormalizeError(
      "Atama önerisi şemaya uymuyor.",
      "SCHEMA_INVALID",
      parsed.error.issues,
    );
  }
  const data: RawSuggestion = parsed.data;

  const itemById = new Map(input.items.map((it) => [it.id, it]));
  const nameIndex = buildNameIndex(input.people, input.locale);
  const assignments: AssignmentWeights = {};
  const droppedItems: string[] = [];

  for (const row of data.assignments) {
    const item = itemById.get(row.lineItemId);
    if (!item) continue;

    const personIds = resolvePersonIds(row.personNames, nameIndex, input.locale);
    if (personIds.length === 0) continue;

    const weights: Record<string, number> = {};
    personIds.forEach((pid, i) => {
      const w = row.weights?.[i] ?? 1;
      if (w > 0) weights[pid] = Math.round(w);
    });

    const clamped = clampWeightsToQty(weights, Math.max(1, Math.round(item.qty)));
    const meta = getItemAssignmentMeta(Math.max(1, Math.round(item.qty)), clamped);

    if (meta.needsQtyAttention) {
      droppedItems.push(row.lineItemId);
      continue;
    }

    if (meta.assignedIds.length > 0) {
      assignments[row.lineItemId] = clamped;
    }
  }

  return {
    assignments,
    source,
    confidence: data.confidence,
    partial: droppedItems.length > 0,
    ...(droppedItems.length > 0 ? { droppedItems } : {}),
    ...(data.notes ? { notes: data.notes } : {}),
  };
}
