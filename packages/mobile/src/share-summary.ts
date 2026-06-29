/**
 * Paylaşım metni üreticisi — WhatsApp vb. için hizalı zengin özet.
 */
import type { ComputedSplit, PersonRow } from "./logic";
import { formatCents } from "./logic";

export interface ShareTextInput {
  currency: string;
  merchant?: string;
  /** ISO tarih (YYYY-MM-DD) veya fişteki ham metin. */
  date?: string;
  computed: ComputedSplit;
  people: readonly PersonRow[];
  equalSplit?: boolean;
}

const LABEL_WIDTH = 14;

function money(currency: string, cents: number): string {
  return `${currency}${formatCents(cents)}`;
}

function amountLine(label: string, currency: string, cents: number, opts?: { prefix?: string }): string {
  const prefix = opts?.prefix ?? "";
  const padded = label.padEnd(LABEL_WIDTH, " ");
  return `${padded}${prefix}${money(currency, cents)}`;
}

/** ISO (YYYY-MM-DD) → DD.MM.YYYY; tanınmazsa olduğu gibi döner. */
export function formatShareDate(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return raw.trim();
}

function personExtraLabel(taxCents: number, tipCents: number): string {
  const parts: string[] = [];
  if (taxCents > 0) parts.push(`KDV ${formatCents(taxCents)}`);
  if (tipCents > 0) {
    parts.push(`Servis/Bahşiş ${formatCents(tipCents)}`);
  }
  return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
}

/**
 * Özet ekranındaki bölüşümü paylaşılabilir metne çevirir.
 */
export function buildShareText(input: ShareTextInput): string {
  const { currency, merchant, computed, people, equalSplit } = input;
  const formattedDate = formatShareDate(input.date);
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const lines: string[] = ["SplitTab"];

  if (merchant?.trim()) {
    lines.push(merchant.trim());
  }
  if (formattedDate) {
    lines.push(formattedDate);
  }
  if (equalSplit) {
    lines.push("(eşit bölündü)");
  }

  lines.push("");
  lines.push("— Fiş —");
  lines.push(amountLine("Kalemler", currency, computed.subtotalCents));

  if (computed.discountCents > 0) {
    lines.push(amountLine("İndirim", currency, computed.discountCents, { prefix: "−" }));
  }
  if (computed.taxCents > 0) {
    lines.push(amountLine("KDV", currency, computed.taxCents));
  }
  if (computed.serviceChargeCents > 0) {
    lines.push(amountLine("Servis", currency, computed.serviceChargeCents));
  }
  if (computed.tipCents > 0) {
    lines.push(amountLine("Bahşiş", currency, computed.tipCents));
  }

  lines.push(amountLine("Toplam", currency, computed.grandTotalCents));
  lines.push("");
  lines.push("— Kişi başı —");

  for (const p of computed.result.perPerson) {
    const name = peopleById.get(p.personId)?.name ?? "Kişi";
    const extra = personExtraLabel(p.taxCents, p.tipCents);
    lines.push(
      `${name}: ${currency}${formatCents(p.totalCents)}${extra}`,
    );
  }

  return lines.join("\n");
}
