/** Neither live catalogue contained a one-character code when this guard was
 * approved. Revisit the minimum if catalogue policy admits such codes later.
 * Length checks never trim or normalise the code sent to the server.
 */
export const CALCULATOR_MIN_QUERY_LENGTH = 2;

export function calculatorSearchReady(query: string): boolean {
  return query.length >= CALCULATOR_MIN_QUERY_LENGTH && query.trim().length > 0;
}

/** Short codes remain valid basket-local assertions; they do not need a search
 * request, but must settle before presenting the explicit ad-hoc action.
 */
export function calculatorExactLookupSettled(
  code: string, settledCode: string, success: boolean, fetching: boolean,
): boolean {
  return code.length > 0 && code === settledCode
    && (!calculatorSearchReady(code) || (success && !fetching));
}
