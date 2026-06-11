import { describe, it, expect, vi } from "vitest";
import { GeminiProvider, ProviderError } from "../src/index.js";
import type { AnalyzeInput } from "../src/types.js";

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/png" };

/** Geçerli (şemadan bağımsız) bir Gemini başarı yanıtı üretir. */
function okResponse(json: unknown): Response {
  const payload = {
    candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
  } as unknown;
  return new Response(JSON.stringify(payload), { status: 200 });
}

const overloaded = (): Response =>
  new Response(
    JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "high demand" } }),
    { status: 503 },
  );

/** Yedek model zincirini devre dışı bırakıp tek modelin retry'ını izole eder. */
const single = (fetchImpl: ReturnType<typeof vi.fn>) =>
  new GeminiProvider({
    apiKey: "test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    fallbackModels: [],
    maxAttempts: 3,
    sleepImpl: async () => {},
  });

describe("GeminiProvider — geçici hata yeniden denemesi", () => {
  it("503'ten sonra başarılı olursa sonucu döndürür (retry)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const result = await single(fetchImpl).analyze(input);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("tüm denemeler 503 ise ProviderError fırlatır", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(overloaded());
    await expect(single(fetchImpl).analyze(input)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("yeniden denenemez hatada (400) anında durur", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(single(fetchImpl).analyze(input)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ağ hatasını geçici kabul edip yeniden dener", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(okResponse({ ok: true }));
    const result = await single(fetchImpl).analyze(input);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("GeminiProvider — yedek modele geçiş (fallback)", () => {
  it("birincil model aşırı yüklüyse yedek modele geçer", async () => {
    // 1. model: 3 deneme de 503 → 2. model: ilk denemede başarı.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const provider = new GeminiProvider({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackModels: ["gemini-2.5-flash-lite"],
      maxAttempts: 3,
      sleepImpl: async () => {},
    });

    const result = await provider.analyze(input);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("kalıcı hatada (400) yedek modele geçmeden durur", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const provider = new GeminiProvider({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackModels: ["gemini-2.5-flash-lite"],
      maxAttempts: 3,
      sleepImpl: async () => {},
    });

    await expect(provider.analyze(input)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
