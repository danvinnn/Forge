import { assessAssurance, type AssuranceDecision, type AssuranceFinding } from "../assurance";
import type { SpiceConfirmationReport } from "./confirm";
import type { Check } from "./verify";

/** Translate SPICE-specific evidence into Forge's one release policy. */
export function assessModelAssurance(options: {
  confirmations: SpiceConfirmationReport | null;
  checks: readonly Check[];
  selectionRequired?: boolean;
  /** Part-specific topology claims that the parameter confirmation cannot see. */
  findings?: readonly AssuranceFinding[];
}): AssuranceDecision {
  const findings: AssuranceFinding[] = [
    ...(options.confirmations?.items ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      state: item.state === "confirmed" ? "confirmed" as const : "review" as const,
      detail: item.detail
    })),
    ...(options.findings ?? [])
  ];
  for (const check of options.checks.filter((candidate) => candidate.verdict === "fail")) {
    findings.push({
      id: `conformance:${check.parameter}:${check.corner}`,
      label: `${check.parameter} ${check.corner} conformance`,
      state: "contradiction",
      detail: `The emitted model measured ${check.measured ?? "no value"} against the datasheet target ${check.expected}.`
    });
  }
  const unverifiable = new Map<string, Check[]>();
  for (const check of options.checks.filter((candidate) => candidate.verdict === "unverifiable")) {
    unverifiable.set(check.parameter, [...(unverifiable.get(check.parameter) ?? []), check]);
  }
  for (const [parameter, checks] of unverifiable) {
    findings.push({
      id: `unverifiable:${parameter}`,
      label: `${parameter} behavior`,
      state: "limitation",
      detail: checks[0].reason ?? "The datasheet does not provide enough test conditions to verify this behavior."
    });
  }
  return assessAssurance({
    findings,
    unresolvedChoices: options.selectionRequired ? ["specification block"] : []
  });
}
