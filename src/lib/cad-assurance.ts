import { assessAssurance, type AssuranceDecision, type AssuranceFinding } from "./assurance";
import { confidenceChecks } from "./confidence";
import type { Confirmation, ConfirmationReport } from "./confirm";
import type { ReviewItem } from "./review";
import type { PinRecord, ResolvedPart } from "./types";

/** Final-output confirmations that genuinely cover the model-read inputs. */
const COVERED_FIELDS: Record<string, readonly string[]> = {
  pinout: ["pins"],
  "pin-count": ["pinCount", "dimensions.leadCount"],
  arrangement: ["dimensions.leadSides", "dimensions.leadsPerSide", "dimensions.vacantLeadSlot"],
  pitch: ["dimensions.pitchMm"],
  body: ["dimensions.bodyLengthMm", "dimensions.bodyWidthMm"],
  "land-pattern": [
    "dimensions.landPadLengthMm",
    "dimensions.landPadWidthMm",
    "dimensions.landSpanMm",
    "dimensions.landSpanCrossMm",
    "dimensions.leadSpanMm",
    "dimensions.leadSpanCrossMm",
    "dimensions.leadWidthMm",
    "dimensions.leadContactMm",
    "dimensions.leadForm",
    "dimensions.mounting",
    "dimensions.leadDiameterMm"
  ],
  "thermal-pad": ["dimensions.thermalPadLengthMm", "dimensions.thermalPadWidthMm"]
};

const REVIEW_LABELS: Record<string, string> = {
  pinout: "Pin names and numbering",
  "pin-count": "Number of pins",
  arrangement: "Package outline",
  pitch: "Package outline",
  body: "Package outline",
  "land-pattern": "Land pattern",
  "thermal-pad": "Land pattern, including exposed pad"
};

function groupForField(field: string): string | null {
  return Object.entries(COVERED_FIELDS).find(([, fields]) => fields.includes(field))?.[0] ?? null;
}

export function cadReviewFindings(
  review: readonly ReviewItem[],
  confirmations: readonly Confirmation[]
): AssuranceFinding[] {
  // A flagged final-output check already asks for the whole claim in one glance.
  // Do not ask once more for every model field underneath that claim. Confirmed
  // checks suppress the raw field because it is settled; flagged checks replace
  // it because their message is the more complete, actionable one.
  const represented = new Set(confirmations.map((item) => item.id));
  const covered = new Set(
    [...represented].flatMap((id) => [...(COVERED_FIELDS[id] ?? [])])
  );
  const grouped = new Map<string, ReviewItem[]>();
  for (const item of review.filter((candidate) => !covered.has(candidate.field))) {
    const id = groupForField(item.field) ?? `record:${item.field}`;
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }
  return [...grouped].map(([id, items]) => ({
    id,
    label: REVIEW_LABELS[id] ?? items[0].label,
    state: "review" as const,
    detail: items.map((item) => `${item.label}: ${item.display}. ${item.consequence}`).join(" ")
  }));
}

/** The unresolved findings a client must carry to the file-producing route. */
export function cadPendingFindings(
  review: readonly ReviewItem[],
  toCheck: readonly Confirmation[]
): AssuranceFinding[] {
  return consolidateCadReviews([
    ...cadReviewFindings(review, toCheck),
    ...toCheck
      .filter((item) => item.state === "flagged")
      .map((item) => ({ id: item.id, label: item.label, state: "review" as const, detail: item.detail }))
  ]);
}

/** One review of the complete copper pattern, including its centre pad. */
function consolidateCadReviews(findings: AssuranceFinding[]): AssuranceFinding[] {
  const land = findings.find((finding) => finding.id === "land-pattern" && finding.state === "review");
  const thermal = findings.find((finding) => finding.id === "thermal-pad" && finding.state === "review");
  let consolidated = !land || !thermal ? findings : findings
    .filter((finding) => finding !== land && finding !== thermal)
    .concat({
      id: "land-pattern",
      label: "Land pattern, including exposed pad",
      state: "review",
      detail: `${land.detail} ${thermal.detail}`
    });
  const mechanical = consolidated.filter(
    (finding) => ["arrangement", "pitch", "body"].includes(finding.id) && finding.state === "review"
  );
  if (mechanical.length > 1) {
    consolidated = consolidated
      .filter((finding) => !mechanical.includes(finding))
      .concat({
        id: "package-outline",
        label: "Package outline",
        state: "review",
        detail: mechanical.map((finding) => finding.detail).join(" ")
      });
  }
  return consolidated;
}

/** Limits that follow from the editable CAD record, not from a stale API snapshot. */
export function cadElectricalTypeLimitations(pins: readonly PinRecord[]): AssuranceFinding[] {
  const unspecifiedTypes = pins.filter((pin) => pin.electricalType === "unspecified").length;
  return unspecifiedTypes === 0
    ? []
    : [{
        id: "electrical-types",
        label: "Electrical-rule-check coverage",
        state: "limitation",
        detail:
          `${unspecifiedTypes} of ${pins.length} pin electrical types were not stated. ` +
          "Forge keeps them unspecified rather than inferring from names; pin names, numbering, and footprint copper are unaffected, but CAD-tool ERC coverage is incomplete."
      }];
}

/** Translate CAD evidence into Forge's product-wide release policy. */
export function assessCadAssurance(
  part: ResolvedPart,
  confirmation: ConfirmationReport | null = null,
  review: readonly ReviewItem[] = []
): AssuranceDecision {
  const confirmationItems = confirmation?.items ?? [];
  const findings: AssuranceFinding[] = [
    ...(confirmationItems.map((item) => ({
      id: item.id,
      label: item.label,
      state: item.state === "confirmed" ? "confirmed" as const : "review" as const,
      detail: item.detail
    })) ?? []),
    ...cadReviewFindings(review, confirmationItems),
    ...confidenceChecks(part)
      .filter((check) => check.state === "fail")
      .map((check) => ({
        id: `record:${check.id}`,
        label: check.label,
        // A manufacturer's printed land pattern is itself an authoritative
        // construction source. Falling outside the transcribed IPC band can
        // mean a vendor house rule or a reading error; it is evidence to review,
        // not proof that the two records contradict each other.
        state: check.id === "printed-in-band" ? "review" as const : "contradiction" as const,
        detail: check.detail
      })),
    ...cadElectricalTypeLimitations(part.pins)
  ];
  // The ordinary lands and exposed thermal land are one copper review. A user
  // checks the complete recommended footprint, not two artefacts, and counting
  // the centre pad separately is what pushed a single package over the five-
  // glance release limit. Preserve both explanations in the combined finding.
  return assessAssurance({ findings: consolidateCadReviews(findings) });
}
