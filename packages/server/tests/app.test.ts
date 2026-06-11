import { describe, it, expect } from "vitest";
import { MockProvider } from "@ahb/ai-orchestrator";
import { createApp } from "../src/app.js";
import { InMemoryQuota } from "../src/cache.js";

const body = JSON.stringify({ imageBase64: "ZmFrZQ==", mimeType: "image/jpeg", locale: "tr-TR" });
const headers = { "content-type": "application/json" };

describe("server /analyze (MockProvider)", () => {
  it("health döner", async () => {
    const app = createApp({ provider: new MockProvider() });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: "mock" });
  });

  it("görüntüyü analiz eder", async () => {
    const app = createApp({ provider: new MockProvider() });
    const res = await app.request("/analyze", { method: "POST", headers, body });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.meta as { currency: string }).currency).toBe("TRY");
    expect((json.receipt as { lineItems: unknown[] }).lineItems).toHaveLength(3);
    expect(json.cached).toBe(false);
  });

  it("ikinci aynı istek önbellekten gelir", async () => {
    const app = createApp({ provider: new MockProvider() });
    await app.request("/analyze", { method: "POST", headers, body });
    const res2 = await app.request("/analyze", { method: "POST", headers, body });
    const json = (await res2.json()) as Record<string, unknown>;
    expect(json.cached).toBe(true);
  });

  it("eksik alanı 400 ile reddeder", async () => {
    const app = createApp({ provider: new MockProvider() });
    const res = await app.request("/analyze", {
      method: "POST",
      headers,
      body: JSON.stringify({ mimeType: "image/jpeg" }),
    });
    expect(res.status).toBe(400);
  });

  it("kota dolunca 429 döner", async () => {
    const app = createApp({ provider: new MockProvider(), quota: new InMemoryQuota(1) });
    const ok = await app.request("/analyze", { method: "POST", headers, body });
    expect(ok.status).toBe(200);
    const body2 = JSON.stringify({ imageBase64: "b3RoZXI=", mimeType: "image/jpeg" });
    const blocked = await app.request("/analyze", { method: "POST", headers, body: body2 });
    expect(blocked.status).toBe(429);
  });

  it("şema dışı provider çıktısını 422 ile reddeder", async () => {
    const app = createApp({ provider: new MockProvider({ foo: "bar" }) });
    const res = await app.request("/analyze", { method: "POST", headers, body });
    expect(res.status).toBe(422);
  });
});
