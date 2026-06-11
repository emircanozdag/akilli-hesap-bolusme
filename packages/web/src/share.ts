import { formatCents } from "@ahb/split-engine";
import type { ComputedSplit, PersonRow, SplitState } from "./adapter.js";

/** Paylaşılabilir kişi başı özet metni üretir (WhatsApp vb.) — DESIGN.md §3. */
export function buildShareText(
  state: SplitState,
  computed: ComputedSplit,
  peopleById: Record<string, PersonRow>,
): string {
  const m = (cents: number) => `${state.currency}${formatCents(cents)}`;
  const lines: string[] = [];
  lines.push(`Hesap bölüşümü — Toplam ${m(computed.grandTotalCents)}`);
  for (const s of computed.result.perPerson) {
    const name = peopleById[s.personId]?.name ?? "Kişi";
    lines.push(`• ${name}: ${m(s.totalCents)}`);
  }
  lines.push("");
  lines.push("Akıllı Hesap Bölüşme ile hesaplandı.");
  return lines.join("\n");
}
