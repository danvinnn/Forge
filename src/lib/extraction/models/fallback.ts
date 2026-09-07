import { ExtractionModelError, type ExtractionModel, type ExtractionRequest, type ExtractionResult } from "../contracts";

/**
 * Use a second equivalent extraction transport when the first cannot answer.
 *
 * Vertex and AI Studio expose the same Gemini model and the same prompt
 * contract, but have independent authentication, quotas and service paths.
 * Treating one path's outage as a failed datasheet read needlessly turns an
 * infrastructure problem into a user question. This wrapper keeps failover at
 * the transport boundary, where it belongs.
 *
 * Only typed provider failures fall through. Spend ceilings, programming
 * errors and deliberate cancellations remain loud; retrying those through a
 * different billable door would hide the real problem or exceed the operator's
 * stated budget.
 */
export function withProviderFallback(primary: ExtractionModel, secondary: ExtractionModel): ExtractionModel {
  return {
    // Keep the primary identity stable for benchmark caches. Both paths run the
    // same model contract; the exact path used is carried by `answeredBy`.
    name: primary.name,
    // A request is allowed to use a feature only when either possible receiver
    // can consume it after failover.
    supportsNativePdf: primary.supportsNativePdf === true && secondary.supportsNativePdf === true,
    isConfigured: () => primary.isConfigured() && secondary.isConfigured(),
    async extract(request: ExtractionRequest): Promise<ExtractionResult> {
      try {
        const result = await primary.extract(request);
        return { ...result, answeredBy: result.answeredBy ?? primary.name };
      } catch (primaryError) {
        if (!(primaryError instanceof ExtractionModelError)) throw primaryError;
        try {
          const result = await secondary.extract(request);
          return {
            ...result,
            answeredBy: result.answeredBy ?? secondary.name,
            notes: [
              ...(result.notes ?? []),
              `The primary extraction service was unavailable; Forge recovered through ${secondary.name}.`
            ]
          };
        } catch (secondaryError) {
          if (!(secondaryError instanceof ExtractionModelError)) throw secondaryError;
          throw new ExtractionModelError(
            secondaryError.kind,
            `Both configured extraction services were unavailable. ${primary.name}: ${primaryError.message}; ` +
              `${secondary.name}: ${secondaryError.message}`,
            (primaryError.attempts ?? 0) + (secondaryError.attempts ?? 0) || undefined
          );
        }
      }
    }
  };
}
