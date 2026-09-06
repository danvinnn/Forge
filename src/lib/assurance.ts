/**
 * One release decision for every artefact Forge produces.
 *
 * Readers and generators report evidence in their own vocabulary; this module
 * owns the policy. A contradiction is never a warning, a choice is never made
 * implicitly, and review items remain visible without making an otherwise
 * buildable artefact impossible to produce.
 */
/** Preferred UI review budget. Exceeding it warns; it does not make valid work impossible. */
export const MAX_REVIEW_ITEMS = 5;

export type AssuranceFindingState = "confirmed" | "review" | "limitation" | "contradiction";

export interface AssuranceFinding {
  id: string;
  label: string;
  state: AssuranceFindingState;
  detail: string;
}

export type AssuranceOutcome = "ready" | "review" | "needs-input" | "refused";

export interface AssuranceDecision {
  outcome: AssuranceOutcome;
  findings: AssuranceFinding[];
  review: AssuranceFinding[];
  contradictions: AssuranceFinding[];
  limitations: AssuranceFinding[];
  missingInputs: string[];
  unresolvedChoices: string[];
}

export function assessAssurance(options: {
  findings?: readonly AssuranceFinding[];
  missingInputs?: readonly string[];
  unresolvedChoices?: readonly string[];
}): AssuranceDecision {
  // One stable id is one claim and therefore one user action. Readers may
  // describe the same claim at several layers (for example a model-read pitch
  // and the final footprint's pitch check); counting those twice turns an
  // evidence graph into a field count. Keep the strongest state if layers
  // disagree, so deduplication can never hide a contradiction.
  const strength: Record<AssuranceFindingState, number> = {
    confirmed: 0,
    limitation: 1,
    review: 2,
    contradiction: 3
  };
  const byId = new Map<string, AssuranceFinding>();
  for (const finding of options.findings ?? []) {
    const current = byId.get(finding.id);
    if (!current || strength[finding.state] > strength[current.state]) byId.set(finding.id, finding);
  }
  const findings = [...byId.values()];
  const review = findings.filter((finding) => finding.state === "review");
  const contradictions = findings.filter((finding) => finding.state === "contradiction");
  const limitations = findings.filter((finding) => finding.state === "limitation");
  const missingInputs = [...new Set(options.missingInputs ?? [])];
  const unresolvedChoices = [...new Set(options.unresolvedChoices ?? [])];
  // Review count is a presentation concern, not evidence that an artefact is
  // wrong. Keep every item visible, but refuse only a proved contradiction;
  // otherwise ask only for facts that actually change the output.
  const outcome: AssuranceOutcome = contradictions.length > 0
    ? "refused"
    : missingInputs.length > 0 || unresolvedChoices.length > 0
      ? "needs-input"
      : review.length > 0
        ? "review"
        : "ready";
  return { outcome, findings, review, contradictions, limitations, missingInputs, unresolvedChoices };
}
