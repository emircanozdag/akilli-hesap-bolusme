import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryHistoryStore } from "../src/history/memory-store";
import { ReceiptAutosave } from "../src/history/autosave";
import type { SplitState } from "../src/logic";

function sampleState(): SplitState {
  return {
    currency: "₺",
    items: [{ id: "i1", name: "Su", price: "5,00", qty: 1 }],
    people: [{ id: "p1", name: "Ben", color: "#6366f1" }],
    assignments: {},
    discountCents: 0,
    serviceChargeCents: 0,
    tax: { included: true, value: "" },
    tip: { mode: "proportional", isPercent: true, value: "" },
  };
}

describe("ReceiptAutosave", () => {
  let store: MemoryHistoryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryHistoryStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounce sonrası kaydeder", async () => {
    const onIdAssigned = vi.fn();
    const autosave = new ReceiptAutosave(store, {
      debounceMs: 800,
      onIdAssigned,
    });

    autosave.schedule({
      id: null,
      state: sampleState(),
      lastStep: 1,
      equalSplit: false,
      status: "draft",
    });

    await vi.advanceTimersByTimeAsync(799);
    expect(await store.listSummaries()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    const id = await autosave.flush();
    expect(id).toBeTruthy();
    expect(onIdAssigned).toHaveBeenCalledOnce();
    expect(await store.listSummaries()).toHaveLength(1);
  });

  it("dirty check: aynı snapshot tekrar yazmaz", async () => {
    const autosave = new ReceiptAutosave(store, { debounceMs: 100 });
    const params = {
      id: null as string | null,
      state: sampleState(),
      lastStep: 1 as const,
      equalSplit: false,
      status: "draft" as const,
    };

    autosave.schedule(params);
    await vi.advanceTimersByTimeAsync(100);
    const id = await autosave.flush();
    expect(id).toBeTruthy();

    autosave.schedule({ ...params, id });
    await vi.advanceTimersByTimeAsync(100);
    await autosave.flush();

    const loaded = await store.load(id!);
    expect(loaded?.updatedAt).toBeDefined();
  });

  it("flush anında kaydeder", async () => {
    const autosave = new ReceiptAutosave(store, { debounceMs: 800 });
    autosave.schedule({
      id: null,
      state: sampleState(),
      lastStep: 2,
      equalSplit: false,
      status: "confirmed",
    });
    const id = await autosave.flush();
    expect(id).toBeTruthy();
    const loaded = await store.load(id!);
    expect(loaded?.status).toBe("confirmed");
    expect(loaded?.lastStep).toBe(2);
  });
});
