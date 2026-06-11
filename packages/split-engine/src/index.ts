/**
 * @ahb/split-engine — Akıllı Hesap Bölüşme motoru (kamusal API).
 * DESIGN.md §4/§5/§8. Saf TypeScript, platformdan bağımsız.
 */

export { computeSplit } from "./split.js";
export { distributeByWeights, distributeEqually } from "./largest-remainder.js";
export { toCents, formatCents, sumCents, assertCents } from "./money.js";
export type { Cents } from "./money.js";
export type {
  LineItem,
  Charges,
  Receipt,
  Person,
  Assignment,
  TipMode,
  UnassignedStrategy,
  SplitInput,
  PersonSplit,
  SplitWarning,
  SplitResult,
} from "./types.js";
