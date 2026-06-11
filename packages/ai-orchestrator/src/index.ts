/**
 * @ahb/ai-orchestrator — sağlayıcı-bağımsız fiş OCR orkestrasyonu (DESIGN.md §7).
 */
export { orchestrate, analyzeRaw, OrchestrationError } from "./pipeline.js";
export type { OrchestrateOptions } from "./pipeline.js";
export { resolveRegional, countryFromLocale } from "./regional.js";
export { ProviderError, SYSTEM_INSTRUCTION } from "./provider.js";
export type { VisionProvider } from "./provider.js";
export { MockProvider, SAMPLE_RECEIPT } from "./providers/mock.js";
export { GeminiProvider } from "./providers/gemini.js";
export type { GeminiOptions } from "./providers/gemini.js";
export {
  rawOcrResultSchema,
  rawLineItemSchema,
  rawChargesSchema,
  rawMetaSchema,
  geminiResponseSchema,
} from "./schema.js";
export type { RawOcrResult, RawLineItem, RawCharges, RawMeta } from "./schema.js";
export type {
  AnalyzeInput,
  AnalyzedReceipt,
  ArithmeticCheck,
  FieldFlag,
  FlagReason,
  Regional,
} from "./types.js";
