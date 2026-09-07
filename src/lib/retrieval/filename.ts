// Filename sanitization for datasheet refs. Filenames come from user uploads and from resolver
// responses (vendor part-number strings), so neither can be trusted to be a safe basename. The generation
// layer will eventually write files named off this, so path traversal and control characters are
// stripped here, at the boundary.
//
// Air-gap safety: no network, no imports that reach the network.

const MAX_NAME_LENGTH = 128;

// Turns an arbitrary string into a safe "<name>.pdf" basename.
export function sanitizeFileName(raw: string, fallback = "datasheet"): string {
  // Take the basename: drop anything before the last / or \, defeating ../ traversal.
  const base = raw.split(/[\\/]/).pop() ?? "";

  // Strip the extension for now; we re-add a normalized .pdf at the end.
  const stem = base.replace(/\.pdf$/i, "");

  // Keep only filename-safe characters. Everything else becomes a single dash.
  let cleaned = stem
    .replace(/[\u0000-\u001f]/g, "") // control chars
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  if (!cleaned) cleaned = fallback;
  if (cleaned.length > MAX_NAME_LENGTH) cleaned = cleaned.slice(0, MAX_NAME_LENGTH);

  return `${cleaned}.pdf`;
}

/**
 * Sanitizes a non-PDF artifact basename without lying about its format.
 *
 * `sanitizeFileName` intentionally normalizes every datasheet to `.pdf`. Using
 * it for an imported `.kicad_mod` renamed the footprint to `.pdf`, after which
 * the importer correctly refused it. Keep the actual extension while applying
 * the same traversal, control-character and length protections.
 */
export function sanitizeArtifactFileName(raw: string, fallback = "vendor-artifact"): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  let cleaned = base
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[^A-Za-z0-9._+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!cleaned) cleaned = fallback;
  if (cleaned.length > MAX_NAME_LENGTH) {
    const extension = /(?:\.[A-Za-z0-9_+-]+)$/.exec(cleaned)?.[0] ?? "";
    cleaned = `${cleaned.slice(0, Math.max(1, MAX_NAME_LENGTH - extension.length))}${extension}`;
  }
  return cleaned;
}
