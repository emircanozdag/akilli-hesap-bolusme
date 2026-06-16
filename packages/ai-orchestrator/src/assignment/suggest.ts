import { normalizeAssignments, AssignmentNormalizeError } from "./normalize.js";
import type { AssignmentProvider } from "./gemini-assign.js";
import { MockAssignmentProvider } from "./mock.js";
import type { SuggestInput, SuggestResult } from "./types.js";

export { AssignmentNormalizeError };

export async function suggestAssignments(
  input: SuggestInput,
  provider: AssignmentProvider = new MockAssignmentProvider(),
): Promise<SuggestResult> {
  const raw = await provider.suggest(input);
  return normalizeAssignments(raw, input, "llm");
}
