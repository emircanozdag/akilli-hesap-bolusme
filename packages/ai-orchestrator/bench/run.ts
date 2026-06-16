/**
 * Tarama benchmark runner — `npm run bench -w @ahb/ai-orchestrator`.
 *
 * Altın-set (bench/golden/manifest.json) üzerinde sağlayıcıları koşturup
 * DESIGN.md §2 metriklerini (kalem F1, toplam-tutar, currency, uçtan uca süre,
 * tahmini düzeltme sayısı) çıkarır ve karşılaştırma tablosu basar.
 *
 * Sağlayıcılar:
 *  - fixture: rawFixture içeren vakalar (ağ/anahtar gerekmez → harness'ı doğrular).
 *  - gemini-flash / gemini-pro: GEMINI_API_KEY varsa, imagePath içeren vakalarda.
 *  - documentai: DOCAI_* env + google-auth-library + ADC varsa (opsiyonel, dinamik import).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentAiProvider, GeminiProvider, MockProvider, orchestrate } from "../src/index.js";
import type { AnalyzedReceipt } from "../src/types.js";
import { failedCase, scoreCase, summarize } from "./metrics.js";
import type { AnalyzeFn, CaseScore, GoldenCase, ProviderSummary } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "golden");

interface Manifest {
  cases: GoldenCase[];
}

function loadManifest(): GoldenCase[] {
  const raw = readFileSync(join(GOLDEN_DIR, "manifest.json"), "utf8");
  return (JSON.parse(raw) as Manifest).cases;
}

function loadFixture(relPath: string): unknown {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, relPath), "utf8"));
}

function loadImageBase64(relPath: string): { base64: string; mimeType: string } {
  const buf = readFileSync(join(GOLDEN_DIR, relPath));
  const mimeType = relPath.endsWith(".png")
    ? "image/png"
    : relPath.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { base64: buf.toString("base64"), mimeType };
}

/** Gemini tabanlı AnalyzeFn (belirli model). */
function geminiAnalyze(model: string): AnalyzeFn {
  const provider = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY!, model, fallbackModels: [] });
  return async ({ imageBase64, mimeType, locale }) =>
    orchestrate(provider, { imageBase64, mimeType, ...(locale ? { hints: { locale } } : {}) });
}

/** Document AI AnalyzeFn — google-auth-library dinamik yüklenir (opsiyonel). */
async function maybeDocumentAiAnalyze(): Promise<AnalyzeFn | null> {
  if (!process.env.DOCAI_PROJECT_ID || !process.env.DOCAI_PROCESSOR_ID) return null;
  try {
    const { GoogleAuth } = (await import("google-auth-library")) as typeof import("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    let clientPromise: ReturnType<GoogleAuth["getClient"]> | undefined;
    const getAccessToken = async (): Promise<string> => {
      if (!clientPromise) clientPromise = auth.getClient();
      const token = (await (await clientPromise).getAccessToken()).token;
      if (!token) throw new Error("ADC access token alınamadı");
      return token;
    };
    const provider = new DocumentAiProvider({
      projectId: process.env.DOCAI_PROJECT_ID,
      location: process.env.DOCAI_LOCATION ?? "eu",
      processorId: process.env.DOCAI_PROCESSOR_ID,
      getAccessToken,
    });
    return async ({ imageBase64, mimeType, locale }) =>
      orchestrate(provider, { imageBase64, mimeType, ...(locale ? { hints: { locale } } : {}) });
  } catch (err) {
    console.warn(`[bench] documentai atlandı: ${(err as Error).message}`);
    return null;
  }
}

async function runProviderOnCase(
  provider: string,
  fn: AnalyzeFn,
  c: GoldenCase,
  input: { imageBase64: string; mimeType: string },
): Promise<CaseScore> {
  const started = Date.now();
  try {
    const analyzed: AnalyzedReceipt = await fn({
      imageBase64: input.imageBase64,
      mimeType: input.mimeType,
      ...(c.locale ? { locale: c.locale } : {}),
    });
    return scoreCase(c.id, provider, analyzed, c.expected, Date.now() - started);
  } catch (err) {
    return failedCase(c.id, provider, (err as Error).message);
  }
}

function printTable(summaries: ProviderSummary[]): void {
  console.log("\n=== Benchmark Özeti (DESIGN.md §2 hedefleri) ===");
  console.log("Hedef: F1 yüksek · toplam %100 · düzeltme <2 · süre <60sn (p50<8sn)\n");
  const header = [
    "provider".padEnd(16),
    "n".padStart(3),
    "F1".padStart(6),
    "total%".padStart(7),
    "curr%".padStart(6),
    "düzelt".padStart(7),
    "p50ms".padStart(7),
    "p95ms".padStart(7),
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const s of summaries) {
    console.log(
      [
        s.provider.padEnd(16),
        String(s.cases).padStart(3),
        s.meanItemF1.toFixed(2).padStart(6),
        (s.totalCorrectRate * 100).toFixed(0).padStart(7),
        (s.currencyCorrectRate * 100).toFixed(0).padStart(6),
        s.meanEstimatedCorrections.toFixed(1).padStart(7),
        String(Math.round(s.p50ElapsedMs)).padStart(7),
        String(Math.round(s.p95ElapsedMs)).padStart(7),
      ].join("  "),
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  const cases = loadManifest();

  // Gerçek (görüntü) vakaları için sağlayıcı kayıt defteri.
  const realProviders: Array<{ name: string; fn: AnalyzeFn }> = [];
  if (process.env.GEMINI_API_KEY) {
    realProviders.push({ name: "gemini-flash", fn: geminiAnalyze(process.env.GEMINI_MODEL ?? "gemini-2.5-flash") });
    realProviders.push({ name: "gemini-pro", fn: geminiAnalyze("gemini-2.5-pro") });
  }
  const docAi = await maybeDocumentAiAnalyze();
  if (docAi) realProviders.push({ name: "documentai", fn: docAi });

  const scoresByProvider = new Map<string, CaseScore[]>();
  const push = (s: CaseScore): void => {
    const arr = scoresByProvider.get(s.provider) ?? [];
    arr.push(s);
    scoresByProvider.set(s.provider, arr);
  };

  for (const c of cases) {
    if (c.rawFixture) {
      // Ağsız self-test: önceden yakalanmış ham çıktı → MockProvider.
      const fixture = loadFixture(c.rawFixture);
      const fn: AnalyzeFn = async ({ locale }) =>
        orchestrate(new MockProvider(fixture), {
          imageBase64: "fixture",
          mimeType: "image/jpeg",
          ...(locale ? { hints: { locale } } : {}),
        });
      push(await runProviderOnCase("fixture", fn, c, { imageBase64: "fixture", mimeType: "image/jpeg" }));
      continue;
    }
    if (c.imagePath) {
      if (realProviders.length === 0) {
        console.warn(`[bench] ${c.id}: gerçek sağlayıcı yok (GEMINI_API_KEY/DOCAI_* ayarla) → atlandı`);
        continue;
      }
      const img = loadImageBase64(c.imagePath);
      for (const p of realProviders) {
        push(await runProviderOnCase(p.name, p.fn, c, img));
      }
    }
  }

  const summaries = [...scoresByProvider.entries()].map(([provider, scores]) => summarize(provider, scores));
  printTable(summaries);

  // CI kapısı: AHB_BENCH_MIN_F1 ayarlıysa, herhangi bir sağlayıcı altına düşerse hata kodu.
  const minF1 = process.env.AHB_BENCH_MIN_F1 ? Number(process.env.AHB_BENCH_MIN_F1) : null;
  if (minF1 !== null) {
    const failing = summaries.filter((s) => s.meanItemF1 < minF1);
    if (failing.length > 0) {
      console.error(`[bench] F1 eşiği (${minF1}) altında: ${failing.map((s) => s.provider).join(", ")}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("[bench] hata:", err);
  process.exit(1);
});
