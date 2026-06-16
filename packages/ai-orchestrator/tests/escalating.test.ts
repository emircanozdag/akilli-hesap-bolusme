import { describe, it, expect, vi } from "vitest";
import { EscalatingProvider, MockProvider, ProviderError } from "../src/index.js";
import type { StreamingVisionProvider, VisionProvider } from "../src/provider.js";
import type { AnalyzeInput } from "../src/types.js";

const input: AnalyzeInput = { imageBase64: "x", mimeType: "image/jpeg" };

/** Dengeli (şüphesiz) bir ham sonuç. */
const balanced = {
  meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.98 },
  lineItems: [{ name: "Steak", totalPriceCents: 2500, confidence: 0.97 }],
  charges: { subtotalCents: 2500, totalCents: 2500, taxIncludedInItems: true },
};

/** Toplamı tutmayan (yükseltme tetikleyen) ham sonuç. */
const unbalanced = {
  meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.98 },
  lineItems: [{ name: "Steak", totalPriceCents: 2500, confidence: 0.97 }],
  charges: { subtotalCents: 2500, totalCents: 9999, taxIncludedInItems: true },
};

/** Düşük güvenli kalem (yükseltme tetikler) ama toplam dengeli. */
const lowConfidence = {
  meta: { currency: "TRY", locale: "tr-TR", currencyConfidence: 0.98 },
  lineItems: [{ name: "?", totalPriceCents: 2500, confidence: 0.3 }],
  charges: { subtotalCents: 2500, totalCents: 2500, taxIncludedInItems: true },
};

/** Belirli sayıda çağrıdan sonra erişilemez hata fırlatan sağlayıcı. */
class BusyProvider implements VisionProvider {
  readonly name = "busy";
  async analyze(): Promise<unknown> {
    throw new ProviderError("Gemini HTTP 503 (overloaded)", "gemini");
  }
}

class ThrowingEscalation implements VisionProvider {
  readonly name = "pro";
  async analyze(): Promise<unknown> {
    throw new ProviderError("Gemini HTTP 429", "gemini");
  }
}

describe("EscalatingProvider — yükseltme kararı", () => {
  it("birincil iyiyse yükseltmez (hızlı yol)", async () => {
    const escalation = new MockProvider(balanced);
    const spy = vi.spyOn(escalation, "analyze");
    const provider = new EscalatingProvider({
      primary: new MockProvider(balanced),
      escalation,
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(balanced);
    expect(spy).not.toHaveBeenCalled();
  });

  it("toplam tutmuyorsa pro'ya yükseltir ve daha iyi sonucu seçer", async () => {
    const onEscalation = vi.fn();
    const provider = new EscalatingProvider({
      primary: new MockProvider(unbalanced),
      escalation: new MockProvider(balanced),
      onEscalation,
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(balanced); // pro dengeli sonucu kazandı
    expect(onEscalation).toHaveBeenCalledOnce();
  });

  it("düşük güven yükseltir; pro daha iyi değilse birincili korur", async () => {
    // Hem birincil hem pro düşük güvende → ikisi de eşit; birincil korunur.
    const provider = new EscalatingProvider({
      primary: new MockProvider(lowConfidence),
      escalation: new MockProvider(lowConfidence),
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(lowConfidence);
  });

  it("pro daha kötüyse (dengesiz) birincili korur", async () => {
    const provider = new EscalatingProvider({
      primary: new MockProvider(lowConfidence), // geçerli ama düşük güven → yükseltilir
      escalation: new MockProvider(unbalanced), // daha kötü
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(lowConfidence);
  });

  it("escalation yoksa şüpheli birincili olduğu gibi döndürür", async () => {
    const provider = new EscalatingProvider({ primary: new MockProvider(unbalanced) });
    const result = await provider.analyze(input);
    expect(result).toEqual(unbalanced);
  });

  it("yükseltme hata verirse birincil sonuçla en iyi çabayı sunar", async () => {
    const provider = new EscalatingProvider({
      primary: new MockProvider(unbalanced),
      escalation: new ThrowingEscalation(),
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(unbalanced);
  });
});

describe("EscalatingProvider — akış yedeği", () => {
  it("akış başarısız olursa tam analiz yoluna düşer (ikinci istek gerekmez)", async () => {
    class FailingStream implements StreamingVisionProvider {
      readonly name = "gemini";
      async analyze(): Promise<unknown> {
        return balanced;
      }
      async analyzeStream(): Promise<unknown> {
        throw new ProviderError("Gemini akış isteği başarısız (ağ, gemini-2.5-flash)", "gemini");
      }
    }
    const provider = new EscalatingProvider({ primary: new FailingStream() });
    const items: unknown[] = [];
    const result = await provider.analyzeStream(input, (it) => items.push(it));
    expect(result).toEqual(balanced);
  });
});

describe("EscalatingProvider — yedeğe düşüş", () => {
  it("birincil erişilemezse yedeğe düşer", async () => {
    const onFallback = vi.fn();
    const provider = new EscalatingProvider({
      primary: new BusyProvider(),
      fallback: new MockProvider(balanced),
      onFallback,
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(balanced);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("geçersiz/engelli API anahtarında (401/403) yedeğe düşer, çökmez", async () => {
    class BadKeyProvider implements VisionProvider {
      readonly name = "gemini";
      async analyze(): Promise<unknown> {
        throw new ProviderError(
          'Gemini HTTP 401 (gemini-2.5-flash): {"error":{"status":"UNAUTHENTICATED","reason":"API_KEY_SERVICE_BLOCKED"}}',
          "gemini",
        );
      }
    }
    const onFallback = vi.fn();
    const provider = new EscalatingProvider({
      primary: new BadKeyProvider(),
      fallback: new MockProvider(balanced),
      onFallback,
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(balanced);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("geçici ağ/bağlantı hatasında yedeğe düşer", async () => {
    class NetworkFailProvider implements VisionProvider {
      readonly name = "gemini";
      async analyze(): Promise<unknown> {
        throw new ProviderError("Gemini isteği başarısız (ağ, gemini-2.5-flash)", "gemini", {
          code: "UND_ERR_CONNECT_TIMEOUT",
        });
      }
    }
    const provider = new EscalatingProvider({
      primary: new NetworkFailProvider(),
      fallback: new MockProvider(balanced),
    });
    const result = await provider.analyze(input);
    expect(result).toEqual(balanced);
  });

  it("yedek yoksa birincil hatası yükselir", async () => {
    const provider = new EscalatingProvider({ primary: new BusyProvider() });
    await expect(provider.analyze(input)).rejects.toBeInstanceOf(ProviderError);
  });

  it("erişilemezlik dışı hatada yedeğe düşmeden hata yükselir", async () => {
    class SchemaProvider implements VisionProvider {
      readonly name = "x";
      async analyze(): Promise<unknown> {
        throw new ProviderError("Gemini JSON ayrıştırılamadı", "gemini");
      }
    }
    const provider = new EscalatingProvider({
      primary: new SchemaProvider(),
      fallback: new MockProvider(balanced),
    });
    await expect(provider.analyze(input)).rejects.toBeInstanceOf(ProviderError);
  });
});
