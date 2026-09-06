/**
 * `/` is the suite.
 *
 * ## The cutover, 2026-09-04
 *
 * This file used to be the workspace: 2,300 lines holding the verdict card, the
 * review list, the question flow, the record panel and the export. `/suite` was
 * built beside it as a purely additive branch so that nothing which worked could
 * regress while it was unfinished, and `HANDOFF.md` set the terms of the swap:
 * when the flow is signed off, `/` becomes a redirect and this file goes.
 *
 * It is signed off. Everything that lived here now lives in one of two places:
 *
 *   `src/lib/record-ui.tsx`  the panels - verdict card, worth a glance, the
 *                            record, the review list, the question panel, the
 *                            page image
 *   `src/lib/verdict.ts`     what the screen SAYS after a read
 *   `src/lib/answers.ts`     what counts as a valid answer, and the bounds
 *
 * Those three exist because two screens rendering their own copies is two
 * products: the divergence is invisible, since each screen looks self-consistent.
 * They were extracted rather than duplicated for exactly that reason, and they
 * are why this file can be deleted rather than maintained in parallel.
 *
 * `bench:browser -- --spice` drives the replacement, including the CAD flow, the
 * question loop and the SPICE build.
 *
 * ## Why a redirect rather than rendering the workspace here
 *
 * `/suite` is `force-dynamic` for the CSP nonce, the reason `layout.tsx`
 * records: a page prerendered at build time has no request to take a nonce from,
 * and the production build then serves a dead page while the dev server works.
 * Rendering the same component from two routes would give one of them the
 * prerender and reintroduce that. One route, one nonce.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/suite");
}
