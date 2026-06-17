const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Liste satırı için göreli tarih (tr-TR). */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";

  const diff = now - then;
  if (diff < MINUTE_MS) return "Az önce";
  if (diff < HOUR_MS) {
    const m = Math.floor(diff / MINUTE_MS);
    return `${m} dk önce`;
  }
  if (diff < DAY_MS) {
    const h = Math.floor(diff / HOUR_MS);
    return `${h} sa önce`;
  }
  if (diff < DAY_MS * 2) return "Dün";
  if (diff < DAY_MS * 7) {
    const d = Math.floor(diff / DAY_MS);
    return `${d} gün önce`;
  }

  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusLabel(status: "draft" | "confirmed" | "shared"): string {
  switch (status) {
    case "draft":
      return "Taslak";
    case "confirmed":
      return "Tamamlandı";
    case "shared":
      return "Paylaşıldı";
  }
}
