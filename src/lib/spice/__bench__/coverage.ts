import type { HoldoutPart } from "./holdout-corpus";

/**
 * Risk cells, not a target part count. A release panel is exhaustive when it
 * covers every cell; another part that reaches no new cell only spends money.
 */
export const REQUIRED_SPICE_CELLS = [
  "class:opamp",
  "class:comparator",
  "class:reference",
  "class:instrumentation",
  "class:ldo",
  "vendor:ti",
  "vendor:adi",
  "vendor:st",
  "vendor:microchip",
  "vendor:onsemi",
  "vendor:renesas",
  "vendor:jrc",
  "era:legacy",
  "era:modern",
  "channels:single",
  "channels:dual",
  "channels:quad",
  "qualification:commercial",
  "qualification:automotive",
  "qualification:rad-hard",
  "variant:fixed",
  "variant:adjustable",
  "variant:current-set",
  "output:open-collector",
  "output:push-pull",
  "power:low-iq",
  "power:high-voltage",
  "layout:legacy-typeset",
  "layout:multi-grade",
  "layout:staggered-header",
  "layout:family-caption"
] as const;

export type SpiceCoverageCell = (typeof REQUIRED_SPICE_CELLS)[number];

const EXTRA: Record<string, SpiceCoverageCell[]> = {
  OPA192: ["era:modern", "channels:single", "qualification:commercial"],
  LM324: ["era:legacy", "channels:quad", "qualification:commercial", "layout:legacy-typeset"],
  TL072: ["era:legacy", "channels:dual", "qualification:commercial", "layout:legacy-typeset"],
  INA333: ["era:modern", "channels:single", "qualification:commercial"],
  TLV3201: ["era:modern", "channels:single", "qualification:commercial", "output:push-pull"],
  REF3025: ["era:modern", "channels:single", "qualification:commercial", "variant:fixed"],
  LT1677: ["era:legacy", "channels:single", "qualification:commercial", "layout:multi-grade", "layout:legacy-typeset"],
  AD8226: ["era:modern", "channels:single", "qualification:commercial"],
  LT1716: ["era:legacy", "channels:single", "qualification:commercial", "output:open-collector", "layout:legacy-typeset"],
  ADR4525: ["era:modern", "channels:single", "qualification:commercial", "variant:fixed"],
  TSZ182: ["era:modern", "channels:dual", "qualification:commercial"],
  TS3011: ["era:modern", "channels:single", "qualification:commercial", "output:push-pull"],
  MCP6541: ["era:modern", "channels:single", "qualification:commercial", "output:push-pull"],
  NCS325: ["era:modern", "channels:single", "qualification:commercial"],
  ISL28118: ["era:modern", "channels:dual", "qualification:commercial", "layout:staggered-header"],
  NJM4580: ["era:legacy", "channels:dual", "qualification:commercial", "layout:legacy-typeset"],
  "LM6142QML-SP": ["era:legacy", "channels:dual", "qualification:rad-hard", "layout:legacy-typeset"],
  "OPA4H014-SEP": ["era:modern", "channels:quad", "qualification:rad-hard"],
  RHF43B: ["era:modern", "channels:single", "qualification:rad-hard"],
  ISL70218SEH: ["era:modern", "channels:dual", "qualification:rad-hard", "layout:staggered-header"],
  TPS7A4901: ["era:modern", "channels:single", "qualification:commercial", "variant:adjustable", "power:high-voltage"],
  LP5912: ["era:modern", "channels:single", "qualification:commercial", "variant:fixed", "layout:family-caption"],
  LT1763: ["era:legacy", "channels:single", "qualification:commercial", "variant:fixed", "layout:legacy-typeset"],
  LT3080: ["era:modern", "channels:single", "qualification:commercial", "variant:current-set"],
  MAX8880: ["era:modern", "channels:single", "qualification:commercial", "variant:fixed", "layout:multi-grade"],
  STLQ020: ["era:modern", "channels:single", "qualification:commercial", "variant:fixed", "power:low-iq"],
  MCP1700: ["era:modern", "channels:single", "qualification:commercial", "variant:fixed", "power:low-iq"],
  NCP1117: ["era:legacy", "channels:single", "qualification:commercial", "variant:adjustable", "layout:legacy-typeset"],
  NCV8705: ["era:modern", "channels:single", "qualification:automotive", "variant:fixed", "power:low-iq"],
  "TPS7H1101A-SP": ["era:modern", "channels:single", "qualification:rad-hard", "variant:adjustable", "power:high-voltage"],
  ISL75052SEH: ["era:modern", "channels:single", "qualification:rad-hard", "variant:adjustable", "layout:staggered-header"]
};

function vendorCell(manufacturer: string): SpiceCoverageCell {
  if (/texas instruments/i.test(manufacturer)) return "vendor:ti";
  if (/analog devices/i.test(manufacturer)) return "vendor:adi";
  if (/stmicro/i.test(manufacturer)) return "vendor:st";
  if (/microchip/i.test(manufacturer)) return "vendor:microchip";
  if (/onsemi/i.test(manufacturer)) return "vendor:onsemi";
  if (/renesas/i.test(manufacturer)) return "vendor:renesas";
  return "vendor:jrc";
}

export function cellsFor(part: HoldoutPart): Set<SpiceCoverageCell> {
  return new Set([
    `class:${part.klass}` as SpiceCoverageCell,
    vendorCell(part.manufacturer),
    ...(EXTRA[part.partNumber] ?? [])
  ]);
}

/** Exact minimum set cover, with deterministic tie-breaking by corpus order. */
export function minimumCoveragePanel(parts: HoldoutPart[]): HoldoutPart[] {
  const required = new Set<SpiceCoverageCell>(REQUIRED_SPICE_CELLS);
  const candidates = parts.map((part, index) => ({ part, index, cells: cellsFor(part) }));
  const missing = [...required].filter((cell) => !candidates.some((candidate) => candidate.cells.has(cell)));
  if (missing.length) throw new Error(`No hold-out candidate covers: ${missing.join(", ")}`);

  let best: number[] | null = null;
  const search = (covered: Set<SpiceCoverageCell>, chosen: number[]) => {
    if (best && chosen.length >= best.length) return;
    const uncovered = [...required].filter((cell) => !covered.has(cell));
    if (uncovered.length === 0) {
      best = [...chosen];
      return;
    }
    const target = uncovered
      .map((cell) => ({ cell, options: candidates.filter((candidate) => !chosen.includes(candidate.index) && candidate.cells.has(cell)) }))
      .sort((a, b) => a.options.length - b.options.length)[0];
    for (const candidate of target.options) {
      const next = new Set(covered);
      for (const cell of candidate.cells) next.add(cell);
      search(next, [...chosen, candidate.index]);
    }
  };
  search(new Set(), []);
  if (!best) throw new Error("The SPICE risk cells have no covering panel.");
  return (best as number[]).sort((a, b) => a - b).map((index) => parts[index]);
}

export function uncoveredCells(parts: HoldoutPart[]): SpiceCoverageCell[] {
  const covered = new Set(parts.flatMap((part) => [...cellsFor(part)]));
  return REQUIRED_SPICE_CELLS.filter((cell) => !covered.has(cell));
}
