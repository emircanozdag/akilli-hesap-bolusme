import { describe, it, expect } from "vitest";
import { QuotaCounter, type DurableObjectState } from "../src/quota-do.js";

function mockState(): DurableObjectState {
  const store = new Map<string, unknown>();
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, value);
      },
    },
  };
}

describe("QuotaCounter", () => {
  it("limit altında consume izin verir", async () => {
    const counter = new QuotaCounter(mockState());
    const res = await counter.fetch(
      new Request("http://do/consume", {
        method: "POST",
        body: JSON.stringify({ maxPerDay: 2 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: true, remaining: 1 });
  });

  it("limit dolunca reddeder", async () => {
    const counter = new QuotaCounter(mockState());
    await counter.fetch(
      new Request("http://do/consume", {
        method: "POST",
        body: JSON.stringify({ maxPerDay: 1 }),
      }),
    );
    const res = await counter.fetch(
      new Request("http://do/consume", {
        method: "POST",
        body: JSON.stringify({ maxPerDay: 1 }),
      }),
    );
    expect(await res.json()).toEqual({ allowed: false, remaining: 0 });
  });
});
