/**
 * Akıllı atama — backend /suggest-assignments ile konuşur.
 */
import type { SuggestInput, SuggestResult } from "@ahb/ai-orchestrator";
import type { SplitState } from "./logic";
import { fetchWithTimeout } from "./fetch-timeout";
import { deviceId, resolveApiBase } from "./api-base";
import { formatHttpError, formatNetworkError, type ApiErrorBody } from "./api-errors";

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
      const detail = (await res.json().catch(() => ({}))) as ApiErrorBody;
      throw new Error(formatHttpError(res.status, detail, "suggest"));
    }
    return (await res.json()) as SuggestResult & { cached?: boolean };
  } catch (err) {
    if (err instanceof Error) {
      if (signal?.aborted) throw err;
      const msg = err.message;
      if (
        err.name === "AbortError" ||
        msg === "Network request failed" ||
        msg.includes("Failed to fetch")
      ) {
        throw new Error(formatNetworkError(err, "suggest"));
      }
      throw err;
    }
    throw new Error(formatNetworkError(err, "suggest"));
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
