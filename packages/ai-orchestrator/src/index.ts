/**
 * @ahb/ai-orchestrator — sağlayıcı-bağımsız fiş OCR orkestrasyonu (DESIGN.md §7).
 */
export {
  orchestrate,
  analyzeRaw,
  OrchestrationError,
  gradeRaw,
  shouldEscalate,
  isBetterGrade,
} from "./pipeline.js";
export type { OrchestrateOptions, RawGrade } from "./pipeline.js";
export { resolveRegional, countryFromLocale } from "./regional.js";
export { ProviderError, SYSTEM_INSTRUCTION, isStreamingProvider } from "./provider.js";
export type { VisionProvider, StreamingVisionProvider } from "./provider.js";
export { extractLineItems, consumeSseBuffer } from "./partial-json.js";
export type { PartialLineItem } from "./partial-json.js";
export { MockProvider, SAMPLE_RECEIPT } from "./providers/mock.js";
export { GeminiProvider } from "./providers/gemini.js";
export type { GeminiOptions } from "./providers/gemini.js";
export { DocumentAiProvider, mapDocAiToRaw, parseAmountToCents } from "./providers/document-ai.js";
export type { DocumentAiOptions } from "./providers/document-ai.js";
export { EscalatingProvider } from "./providers/escalating.js";
export type { EscalatingOptions } from "./providers/escalating.js";
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
export { heuristicSuggest } from "./assignment/heuristics.js";
export {
  normalizeAssignments,
  normalizePersonName,
  AssignmentNormalizeError,
} from "./assignment/normalize.js";
export { clampWeightsToQty, getItemAssignmentMeta } from "./assignment/clamp.js";
export { suggestAssignments } from "./assignment/suggest.js";
export {
  GeminiAssignmentProvider,
  type AssignmentProvider,
  type GeminiAssignmentOptions,
} from "./assignment/gemini-assign.js";
export { MockAssignmentProvider } from "./assignment/mock.js";
export {
  suggestInputSchema,
  rawSuggestionSchema,
  geminiAssignmentResponseSchema,
} from "./assignment/schema.js";
export type {
  SuggestInput,
  SuggestItem,
  SuggestPerson,
  SuggestResult,
  RawSuggestion,
  RawAssignmentRow,
  AssignmentWeights,
  SuggestSource,
} from "./assignment/types.js";
