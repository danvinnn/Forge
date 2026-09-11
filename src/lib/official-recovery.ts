import type { Intent } from "./intent";

export interface RecoverableOfficialResource {
  kind: "spice" | "cad" | "step" | "pinout" | "package-drawing" | "application-note";
  url: string;
}

export interface OfficialArtifactCandidate {
  fileName: string;
}

function tokens(value: string): string[] {
  return value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  return haystack.some((_token, at) => needle.every((token, offset) => haystack[at + offset] === token));
}

/**
 * Selects one manufacturer file only when its filename identifies it uniquely.
 * A unique match is evidence; first-in-the-archive is not. Package matching is
 * intentionally used only to narrow CAD files and ignores caption filler such
 * as "lead" and "package".
 */
export function recognizedOfficialArtifact<T extends OfficialArtifactCandidate>(
  candidates: readonly T[],
  kind: "cad" | "step" | "spice" | "pinout",
  identity: { partNumber?: string | null; packageType?: string | null }
): T | null {
  if (candidates.length === 1) return candidates[0];
  const partTokens = tokens(identity.partNumber ?? "");
  const packageTokens = tokens(identity.packageType ?? "").filter(
    (token) => !["LEAD", "LEADS", "PIN", "PINS", "PACKAGE", "PLASTIC", "CERAMIC"].includes(token)
  );
  const names = candidates.map((candidate) => ({ candidate, tokens: tokens(candidate.fileName.replace(/\.[^.]+$/, "")) }));
  const partMatches = partTokens.length > 0
    ? names.filter((entry) => containsSequence(entry.tokens, partTokens))
    : [];
  if (partMatches.length === 1) return partMatches[0].candidate;

  if ((kind === "cad" || kind === "step" || kind === "pinout") && packageTokens.length > 0) {
    const pool = partMatches.length > 1 ? partMatches : names;
    const packageMatches = pool.filter((entry) => packageTokens.every((token) => entry.tokens.includes(token)));
    if (packageMatches.length === 1) return packageMatches[0].candidate;
  }
  return null;
}

/**
 * Official artifacts Forge should attempt without asking the user to press an
 * import button. Discovery order is preserved because resolvers already rank
 * manufacturer-direct results ahead of broader search results.
 */
export function automaticOfficialImports<T extends RecoverableOfficialResource>(
  resources: readonly T[],
  intent: Intent,
  have: { cad: boolean; spice: boolean; step?: boolean; pinout?: boolean },
  attempted: ReadonlySet<string>
): T[] {
  const wantsCad = intent === "cad" || intent === "both";
  const wantsSpice = intent === "spice" || intent === "both";
  return resources.filter((resource) => {
    if (attempted.has(resource.url)) return false;
    if (resource.kind === "cad") return wantsCad && !have.cad;
    if (resource.kind === "step") return wantsCad && !have.step;
    if (resource.kind === "pinout") return wantsCad && !have.pinout;
    if (resource.kind === "spice") return wantsSpice && !have.spice;
    return false;
  });
}
