import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWithTimeout } from "../src/fetch-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("istek tamamlanınca yanıt döner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      }),
    );
    const res = await fetchWithTimeout("http://test/health", {}, 1000);
    expect(res.ok).toBe(true);
  });
});
