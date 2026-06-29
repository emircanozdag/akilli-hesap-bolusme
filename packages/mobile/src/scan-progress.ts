import type { ScanPhase } from "./api";

const TOTAL_STEPS = 4;

/** Kullanıcıya gösterilen tarama adımları (sıralı). */
export const SCAN_PROGRESS_STEPS: ReadonlyArray<{
  phase: Exclude<ScanPhase, "idle">;
  label: string;
}> = [
  { phase: "picking", label: "Fiş seçiliyor" },
  { phase: "preparing", label: "Fotoğraf hazırlanıyor" },
  { phase: "uploading", label: "Sunucuya gönderiliyor" },
  { phase: "analyzing", label: "Kalemler okunuyor" },
];

const PHASE_INDEX: Record<Exclude<ScanPhase, "idle">, number> = {
  picking: 1,
  preparing: 2,
  uploading: 3,
  analyzing: 4,
};

const PHASE_BASE_PERCENT: Record<Exclude<ScanPhase, "idle">, number> = {
  picking: 10,
  preparing: 25,
  uploading: 40,
  analyzing: 48,
};

/** analyzing fazında süreye göre yumuşak artış (60 sn'de ~+42 puan). */
const ANALYZE_RAMP_MS = 60_000;
const ANALYZE_RAMP_PERCENT = 42;
const MAX_PERCENT = 96;

export interface ScanProgressInput {
  phase: ScanPhase;
  /** Akıştan gelen kalem sayısı (algılanan ilerleme). */
  streamItemCount?: number;
  /** analyzing fazına geçiş zaman damgası (ms). */
  analyzingStartedAt?: number;
}

export function scanProgressStep(phase: ScanPhase): {
  current: number;
  total: number;
  label: string;
} | null {
  if (phase === "idle") return null;
  const step = SCAN_PROGRESS_STEPS.find((s) => s.phase === phase);
  return {
    current: PHASE_INDEX[phase],
    total: TOTAL_STEPS,
    label: step?.label ?? "İşleniyor",
  };
}

export function scanProgressPercent(input: ScanProgressInput): number {
  const { phase } = input;
  if (phase === "idle") return 100;

  let percent = PHASE_BASE_PERCENT[phase];

  if (phase === "analyzing") {
    if (input.analyzingStartedAt != null) {
      const elapsed = Math.max(0, Date.now() - input.analyzingStartedAt);
      percent += (elapsed / ANALYZE_RAMP_MS) * ANALYZE_RAMP_PERCENT;
    }
    const items = input.streamItemCount ?? 0;
    if (items > 0) {
      percent += Math.min(12, items * 3);
    }
  }

  return Math.min(MAX_PERCENT, Math.round(percent));
}

/** Adım altı kısa durum metni. */
export function scanProgressHint(input: ScanProgressInput): string | null {
  if (input.phase === "analyzing") {
    const n = input.streamItemCount ?? 0;
    if (n > 0) return `${n} kalem bulundu — devam ediyor…`;
    return "30–60 sn sürebilir";
  }
  if (input.phase === "uploading") return "Bağlantı hızına bağlı";
  return null;
}
