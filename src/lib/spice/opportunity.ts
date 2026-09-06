import { DEVICE_CLASSES } from "./model";
import { VENDOR_PRIMITIVE_TERMINALS } from "./vendor";

/**
 * The complete set of ways Forge can honestly hand over a SPICE artefact.
 * This is a strategy registry, not a list of marketing component categories:
 * an arbitrary integrated circuit ultimately enters SPICE as a subcircuit.
 */
export const SPICE_MODEL_STRATEGIES = {
  generatedBehavioural: DEVICE_CLASSES.map((deviceClass) => deviceClass.id),
  reviewedBehavioural: DEVICE_CLASSES.map((deviceClass) => deviceClass.id),
  vendorSubcircuit: "any standalone .SUBCKT with declared terminals",
  vendorPrimitiveModels: Object.keys(VENDOR_PRIMITIVE_TERMINALS).sort()
} as const;

export type ModelDisposition =
  | "generated"
  | "vendor-backed"
  | "configuration-required"
  | "page-review-required"
  | "vendor-model-required"
  | "user-selection-required"
  | "vendor-file-unusable";

export interface ModelOpportunity {
  disposition: ModelDisposition;
  resolved: boolean;
}

/** One decision function means an API refusal can never fall through unnamed. */
export function unresolvedOpportunity(options: {
  correctionAvailable: boolean;
  configurationAvailable: boolean;
}): ModelOpportunity {
  if (options.correctionAvailable) return { disposition: "page-review-required", resolved: false };
  if (options.configurationAvailable) return { disposition: "configuration-required", resolved: false };
  return { disposition: "vendor-model-required", resolved: false };
}

export const GENERATED_OPPORTUNITY: ModelOpportunity = { disposition: "generated", resolved: true };
export const VENDOR_OPPORTUNITY: ModelOpportunity = { disposition: "vendor-backed", resolved: true };
