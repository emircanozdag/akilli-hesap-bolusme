/**
 * Ortam değişkenlerinden sağlayıcı kurulumu — sağlayıcı-bağımsızlık (§6.2).
 * Anahtar yoksa MockProvider'a düşer → anahtarsız yerel geliştirme/test.
 */
import { GeminiProvider, MockProvider, type VisionProvider } from "@ahb/ai-orchestrator";

export interface Env {
  AHB_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

export function buildProvider(env: Env): VisionProvider {
  const choice = (env.AHB_PROVIDER ?? "").toLowerCase();

  if (choice === "gemini" || (!choice && env.GEMINI_API_KEY)) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("AHB_PROVIDER=gemini için GEMINI_API_KEY gerekli");
    }
    return new GeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL ?? "gemini-2.5-flash",
      fallbackModels: ["gemini-2.5-flash-lite", "gemini-2.0-flash"],
    });
  }

  return new MockProvider();
}
