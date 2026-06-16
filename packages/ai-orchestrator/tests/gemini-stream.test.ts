import { describe, it, expect, vi } from "vitest";
import { GeminiProvider, ProviderError } from "../src/index.js";
import type { PartialLineItem } from "../src/index.js";
import type { AnalyzeInput } from "../src/types.js";

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/jpeg" };

/** Bir metin parçasını Gemini SSE `data:` satırına sarar. */
function sseLine(text: string): string {
  const obj = { candidates: [{ content: { parts: [{ text }] } }] };
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Verilen string parçalarından SSE gövdeli bir Response üretir. */
function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe("GeminiProvider.analyzeStream — akışlı kalemler", () => {
  it("kalemler geldikçe onItem yayınlar ve tam JSON döndürür", async () => {
    // Tam hedef JSON, üç SSE olayına bölünmüş metin parçalarıyla akıyor.
    const chunks = [
      sseLine('{"meta":{"currency":"TRY"},"lineItems":['),
      sseLine('{"name":"Steak","totalPriceCents":2500,"confidence":0.9},'),
      sseLine(
        '{"name":"Salata","totalPriceCents":800,"confidence":0.9}],' +
          '"charges":{"subtotalCents":3300,"totalCents":3300,"taxIncludedInItems":true}}',
      ),
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(streamResponse(chunks));
    const provider = new GeminiProvider({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackModels: [],
    });

    const seen: PartialLineItem[] = [];
    const raw = (await provider.analyzeStream(input, (it) => seen.push(it))) as {
      lineItems: unknown[];
      charges: { totalCents: number };
    };

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ name: "Steak", totalPriceCents: 2500 });
    expect(seen[1]).toMatchObject({ name: "Salata", totalPriceCents: 800 });
    expect(raw.lineItems).toHaveLength(2);
    expect(raw.charges.totalCents).toBe(3300);

    // streamGenerateContent + alt=sse uç noktasına gitti mi?
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("streamGenerateContent");
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("alt=sse");
  });

  it("HTTP hatasında ProviderError fırlatır (çağıran tek-seferliğe düşer)", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 503 }));
    const provider = new GeminiProvider({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackModels: [],
    });
    await expect(provider.analyzeStream(input, () => {})).rejects.toBeInstanceOf(ProviderError);
  });
});
