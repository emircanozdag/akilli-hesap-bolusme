import { describe, expect, it, beforeEach } from "vitest";
import { MemoryHistoryStore } from "../src/history/memory-store";
import { buildSavedReceipt } from "../src/history/serialize";
import { MAX_RECEIPTS } from "../src/history/types";
import type { SplitState } from "../src/logic";

function stateWithName(name: string): SplitState {
  return {
    currency: "₺",
    items: [{ id: `i-${name}`, name, price: "10,00", qty: 1 }],
    people: [{ id: "p1", name: "Ben", color: "#6366f1" }],
    assignments: {},
    discountCents: 0,
    serviceChargeCents: 0,
    tax: { included: true, value: "" },
    tip: { mode: "proportional", isPercent: true, value: "" },
  };
}

function receipt(id: string, title: string, updatedAt: string) {
  return buildSavedReceipt({
    id,
    state: stateWithName(title),
    lastStep: 1,
    equalSplit: false,
    status: "draft",
    updatedAt,
    createdAt: updatedAt,
  });
}

describe("MemoryHistoryStore", () => {
  let store: MemoryHistoryStore;

  beforeEach(() => {
    store = new MemoryHistoryStore();
  });

  it("upsert ve load round-trip", async () => {
    const saved = receipt("a", "Kebap", "2026-06-16T10:00:00.000Z");
    await store.upsert(saved);
    const loaded = await store.load("a");
    expect(loaded?.title).toBe("Kebap");
    expect(loaded?.state.items[0]?.name).toBe("Kebap");
  });

  it("listSummaries updatedAt desc sıralar", async () => {
    await store.upsert(receipt("old", "Eski", "2026-06-15T10:00:00.000Z"));
    await store.upsert(receipt("new", "Yeni", "2026-06-16T10:00:00.000Z"));
    const list = await store.listSummaries();
    expect(list[0]?.id).toBe("new");
  });

  it("LRU: MAX_RECEIPTS üstünde en eski silinir", async () => {
    for (let i = 0; i < MAX_RECEIPTS + 5; i++) {
      const ts = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      await store.upsert(receipt(`id-${i}`, `Fiş ${i}`, ts));
    }
    const list = await store.listSummaries();
    expect(list.length).toBe(MAX_RECEIPTS);
    expect(await store.load("id-0")).toBeNull();
    expect(await store.load("id-4")).toBeNull();
    expect(await store.load(`id-${MAX_RECEIPTS + 4}`)).not.toBeNull();
  });

  it("findByImageHash eşleşme döner", async () => {
    const saved = receipt("x", "Hash", "2026-06-16T10:00:00.000Z");
    saved.imageHash = "abc123";
    await store.upsert(saved);
    const hit = await store.findByImageHash("abc123");
    expect(hit?.id).toBe("x");
  });

  it("remove ve clear", async () => {
    await store.upsert(receipt("a", "A", "2026-06-16T10:00:00.000Z"));
    await store.remove("a");
    expect(await store.load("a")).toBeNull();
    await store.upsert(receipt("b", "B", "2026-06-16T11:00:00.000Z"));
    await store.clear();
    expect(await store.listSummaries()).toHaveLength(0);
  });
});
