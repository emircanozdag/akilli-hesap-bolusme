/**
 * Akıllı atama — backend /suggest-assignments ile konuşur.
 */
import type { SuggestInput, SuggestResult } from "@ahb/ai-orchestrator";
import type { SplitState } from "./logic";
import { fetchWithTimeout } from "./fetch-timeout";
import { deviceId, resolveApiBase } from "./api-base";

const SUGGEST_TIMEOUT_MS = 15_000;

export function buildSuggestInput(state: SplitState, locale = "tr-TR"): SuggestInput {
  return {
    items: state.items.map((it) => ({
      id: it.id,
      name: it.name.trim() || "Kalem",
      qty: Math.max(1, Math.round(it.qty || 1)),
    })),
    people: state.people.map((p) => ({
      id: p.id,
      name: p.name.trim() || "Kişi",
    })),
    locale,
  };
}

export async function suggestAssignmentsViaServer(
  input: SuggestInput,
  signal?: AbortSignal,
): Promise<SuggestResult & { cached?: boolean }> {
  const url = `${resolveApiBase()}/suggest-assignments`;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort);
  }

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-id": deviceId(),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      },
      SUGGEST_TIMEOUT_MS,
    );

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `Sunucu hatası (${res.status})`);
    }
    return (await res.json()) as SuggestResult & { cached?: boolean };
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
