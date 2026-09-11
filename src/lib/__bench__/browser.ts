/**
 * Does the application actually run in a browser?
 *
 * ## Why this exists
 *
 * On 2026-08-24 the product was found to have been serving a dead page for its
 * whole life. `next.config.ts` set `script-src 'self'`, Next boots the client
 * from inline `<script>` elements, and the browser refused every one of them.
 * React never hydrated. The status line sat on "Loading...", and choosing a
 * datasheet did nothing at all, because the file input had no handler bound to
 * it. That is the "we cannot upload files" the customer reported.
 *
 * EVERY OTHER INSTRUMENT IN THIS REPO WAS GREEN. `npm test` passed, `tsc`
 * passed, `next build` succeeded, `bench:extraction` reported 52 of 57 parts
 * shipping, and every route answered correctly under `curl`, because a route
 * handler does not care whether a browser ever ran the page that calls it. The
 * gap was not subtle and nothing could see it: no instrument here had ever
 * loaded the app.
 *
 * The same shape then repeated INSIDE the fix. A nonce policy made the dev
 * server work and left the production build dead, because `/` was prerendered
 * at build time and a static page has no request to take a nonce from. Caught
 * only by running this against `npm start`. See `src/app/layout.tsx`.
 *
 * ## What it checks, and what it costs
 *
 * The default pass is FREE and makes no model call. It loads the page, proves
 * it hydrated, and walks the settings screen and the first-run gate, collecting
 * every console error, uncaught exception, failed request and 4xx/5xx along the
 * way. That is enough to catch the entire class above, which is the class that
 * takes the product from working to worthless.
 *
 * `--full` additionally uploads a datasheet and exports a library, which is one
 * real model call and therefore real money. Worth it before a release and not
 * on every change.
 *
 *   npm run build && npm run bench:browser
 *   npm run build && npm run bench:browser -- --full
 *
 * Needs a browser binary once: `npx playwright install chromium`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOCUMENT_READ_ROUTE_BUDGET_MS } from "../extraction/budget";

const FULL = process.argv.includes("--full");
/** Offline browser proof for the vendor-adapter recovery seams only. */
const ADAPTERS_ONLY = process.argv.includes("--spice-adapters");
/**
 * Accepted and no longer meaningful.
 *
 * `--spice` selected the `/suite` pass while `/` still served its own workspace.
 * `/` is now a redirect and there is one screen, so this pass is the only pass.
 * The flag is still tolerated because it is in people's shell history.
 *
 *   npm run build && npm run bench:browser           free
 *   npm run build && npm run bench:browser -- --full spends: reads two datasheets
 *                                                    and builds a SPICE model
 */
const SPICE = true;
/**
 * The datasheets the `--full` pass drives, from the repo's own caches.
 *
 * Several, and deliberately unalike: one path through one document proves that
 * one document works. The review panel only appears when something was read at
 * low confidence or off a drawing, and the question flow only appears when the
 * generator is short a number, so a single well-read part exercises neither.
 */
const PARTS = (process.argv.find((argument) => argument.startsWith("--parts="))?.slice("--parts=".length) ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const ROOT = process.cwd();
/** Not 3000: a dev server is usually already sitting there while working. */
const PORT = Number(process.env.PORT ?? 3210);
const BASE = `http://localhost:${PORT}`;
/**
 * The datasheet to upload, from the repo's own test data.
 *
 * NOT from `.holdout-cache`. Nothing in the hold-out corpus is opened for any
 * purpose, and a UI check is not an exception.
 */
/**
 * A parse takes p50 76s and p90 129s of model time, so every wait here is sized
 * from that rather than picked. A generous timeout costs nothing when a step
 * succeeds and is paid IN FULL every time one fails, which is how a four
 * datasheet run reached half an hour with no way to see where it was.
 */
// The browser must wait longer than the route it is measuring. When provider
// failover was added, a request could legitimately remain in recovery until
// the route's 240-second ceiling; the old 180-second browser wait then declared
// the UI dead while the server was still working. Keep one source of truth and
// leave a small allowance for rendering the response in React.
const PARSE_MS = DOCUMENT_READ_ROUTE_BUDGET_MS + 30_000;
const EXPORT_MS = 60_000;

/**
 * Two by default, not four.
 *
 * Each datasheet is at least one real model call and often two, since choosing
 * a package can re-read the document. This is meant to be run often, so the
 * default is the smallest set that still covers an upload, a chooser and every
 * format. Go wider deliberately:
 *
 *   npm run bench:browser -- --full --parts=DRV8825,RHF1201,STM32F103C8
 */
const DEFAULT_PDFS = [
  join(ROOT, "test-data", "LMP7704-SP.pdf"),
  join(ROOT, ".bench-cache", "DRV8825.pdf"),
  // A FAMILY DATASHEET, so the package chooser is actually exercised. Without
  // one, `package-chosen` and `re-read-warned` went unreached every run and the
  // screen where 2026-08-24's chooser defect lived was never opened.
  join(ROOT, ".bench-cache", "AD8628.pdf"),
  // A PART THAT ASKS A QUESTION, so the answering half is exercised every run.
  //
  // RHF1201's ceramic SO48 has a body wider than the assembler's install-wide
  // seated span, so the export refuses and asks for a span for that package.
  // Without a part like it in this list the question flow is never driven, and
  // on 2026-08-29 that hid two defects at once: the bench's selector for the
  // answer boxes matched nothing, and behind it the screen was overwriting the
  // user's answer with the very number that could not work.
  join(ROOT, ".bench-cache", "RHF1201.pdf")
];

/**
 * WHICH OF THE VERDICT CARD'S SEVEN OUTCOMES IS ON SCREEN.
 *
 * Matched on the headline rather than the DOM class, because two of the seven
 * share a tone: `check` covers "a pinout was refused", "not enough was read",
 * "values need checking" and "no package can be built", and those are four
 * different screens with four different next actions. A tone would report them
 * as one and hide three.
 *
 * Kept in the order `page.tsx` tests them, so a headline that could match two
 * lands on the one the product would have shown.
 */
function verdictState(text: string): string {
  return VERDICT_STATES.find((state) => state.test.test(text))?.id ?? "UNRECOGNISED";
}

const VERDICT_STATES: Array<{ id: string; test: RegExp }> = [
  { id: "refused-pinout", test: /pinout was read and then refused/i },
  { id: "not-enough-read", test: /Not enough was read to build anything/i },
  { id: "which-package", test: /Which package\?/i },
  { id: "needs-numbers", test: /numbers? (?:is|are) needed before this can be built/i },
  { id: "needs-checking", test: /values? (?:needs|need) checking first/i },
  { id: "nothing-buildable", test: /No package in this datasheet can be built yet/i },
  { id: "ready", test: /Ready to build/i }
];

/**
 * A PLAUSIBLE ANSWER, not the same number every time.
 *
 * This typed `10.16` into every box. On VA10820 - a 128-pin ceramic LQFP whose
 * body is about 14 mm across - the screen asks for a formed lead span and says,
 * in the question's own text, that a span shorter than the body would put every
 * land underneath the part. 10.16 is shorter than the body, so the product
 * refused it, said exactly why, and this bench reported "asked for a value, was
 * answered, and still did not build" - a false finding against correct
 * behaviour, and a whole run failed on it.
 *
 * An instrument that ignores what the screen tells it is not testing the screen.
 * So the question's own text is read, and where it names a size the answer is
 * comfortably clear of it.
 */
async function answerFor(_page: import("playwright").Page, box: import("playwright").Locator): Promise<string> {
  // THE WHOLE GROUP, not the one row.
  //
  // `AskPanel` prints a question's explanation ONCE per run of questions that
  // share it, because three consecutive fields explaining themselves with the
  // same paragraph is three times the height and no more information. So the
  // second question in a group has no `why` of its own, and reading only its row
  // found no stated bound, fell back to a default, and reported an answerable
  // question as an unanswerable loop. A person reads the paragraph above; so
  // does this.
  const why = await box
    .locator("xpath=ancestor::div[contains(@class,'ask-group')]")
    .innerText()
    .catch(() => "");
  // A STATED MINIMUM WINS OVER EVERY OTHER FIGURE IN THE TEXT.
  //
  // The corner-lands refusal names half a dozen millimetre values - the pitch,
  // the land width, the length, the span in hand - and only one of them is the
  // bound the answer has to clear. Taking the largest picked the wrong one and
  // this bench reported an answerable question as an unanswerable loop, four
  // rounds deep, on VA10820. Offline the same refusal ships on the first try
  // when it is given a number just over its stated minimum.
  //
  // A person reads the sentence. So does this.
  const stated = /more than ([\d.]+)\s*mm/.exec(why);
  if (stated) return (Number(stated[1]) * 1.1).toFixed(2);

  // Otherwise the largest figure the question mentions, which on a question that
  // states one size is the dimension the answer has to clear.
  const sizes = [...why.matchAll(/([\d.]+)\s*mm/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const largest = sizes.length > 0 ? Math.max(...sizes) : 0;
  const wanted = largest > 0 ? largest * 1.3 : 10.16;

  // THE BOX'S OWN CEILING WINS.
  //
  // A formed FOOT is a feature of one lead and the route caps it at 5 mm, while
  // a lead SPAN is a distance across the package and is capped at 200. The
  // largest millimetre figure in a question about the foot is the package's
  // width, so scaling it up produced 9-something for a box whose maximum is 5:
  // the screen refused it beside the box, the question stayed, and this bench
  // reported "asked again after being answered" - a real defect's message for
  // its own bad input. The attribute is what a person sees on the control.
  const ceiling = Number(await box.getAttribute("max").catch(() => null));
  const capped = Number.isFinite(ceiling) && ceiling > 0 ? Math.min(wanted, ceiling) : wanted;
  return capped.toFixed(2);
}


function datasheets(): string[] {
  const chosen = PARTS.length > 0 ? PARTS.map((name) => join(ROOT, ".bench-cache", `${name}.pdf`)) : DEFAULT_PDFS;
  return chosen.filter((path) => {
    if (existsSync(path)) return true;
    // A CACHED DATASHEET THAT IS NOT HERE IS NOT A BROWSER PROBLEM.
    //
    // Three of the four defaults live in the gitignored `.bench-cache/`, so on a
    // fresh checkout - a CI runner most of all - they cannot exist. Counting
    // their absence as something the browser did wrong failed this bench on
    // every CI run once the step was finally reached (2026-09-07), while the
    // page itself was clean.
    //
    // Under `--full` it stays a problem, because that pass is run deliberately
    // on a machine that HAS the caches and its whole purpose is to drive these
    // documents; a missing one there means the run silently covered less than it
    // was asked to. In the default pass nothing drives them, and the coverage
    // line below already reports which paths went unexercised.
    if (FULL) problems.push(`[missing] ${path}`);
    return false;
  });
}

/** Everything the browser complained about, in the order it complained. */
const problems: string[] = [];

/**
 * Open only across the stage that posts a deliberately invalid file.
 *
 * The response listener treats every 4xx as a finding, and one stage causes a
 * 400 on purpose. Scoping the exemption to the stage rather than to the MODE
 * keeps that honest: the previous version exempted it only on the free pass, so
 * a full pass failed on its own test fixture while all fourteen stages passed.
 */
let expectingJunkUpload = false;
/** How many times the page has actually asked the server to build a library. */
/** Stages that were supposed to happen. A stage that did not is a failure. */
const reached = new Set<string>();

/**
 * A running log on disk, written synchronously.
 *
 * A `--full` pass takes tens of minutes and Node buffers stdout when it is a
 * pipe, so watching it through `tail` or a task file shows nothing at all until
 * the process exits. That is not a cosmetic problem: it makes a stuck run
 * indistinguishable from a slow one, which is exactly the situation this file
 * exists to stop happening elsewhere.
 */
const LOG = join(ROOT, ".bench-browser.log");

function note(line: string) {
  console.log(line);
  try {
    appendFileSync(LOG, `${line}\n`);
  } catch {
    // A log we cannot write is not a reason to fail the run.
  }
}

/**
 * Kills the server and everything it spawned.
 *
 * The whole GROUP, by negating the pid, because the handle we hold is `npx` and
 * the process holding the port is its grandchild. See `detached` at the spawn.
 */
function stopServer(server: ChildProcess | undefined): void {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    // Already gone, or the platform declined a group kill. Fall back to the
    // handle, which is still better than nothing.
    server.kill("SIGKILL");
  }
}

/** Is anything answering on the port this bench wants for its own server? */
async function respondsOnPort(): Promise<boolean> {
  try {
    await fetch(`${BASE}/api/config`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    // A connection refused, which is what a free port looks like. A server that
    // answers with an ERROR still counts as present, which is deliberate: the
    // stale build that prompted this answered 200 on some paths and 400 on
    // others, and either way it is not ours.
    return false;
  }
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
        const response = await fetch(`${BASE}/api/config`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return true;
      } catch {
        // Not up yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  // `settle` went with the old `/` pass: it waited on `footer.status`, which
  // only that screen had. `/suite` is waited on by the control that appears when
  // a stage finishes, which is what a person waits for too.

  /**
   * THE SPICE PASS, on `/suite`.
   *
   * `SPICE.md` shipped a route, a reader, an emitter, a verifier and 54 tests,
   * and the button that reaches all of it had never been pressed by anything.
   * The CAD half learned this lesson on 2026-08-24, when the whole application
   * had been serving a dead page for its entire life with every other instrument
   * green. This is that check, pointed at the screen that was added afterwards.
   *
   * The free pass proves the screen runs and that choosing a datasheet does not
   * hit a route that is not there. `--full` presses the button and requires a
   * zip with the three files in it.
   */
  async function suiteChecks(page: import("playwright").Page) {
    const SUITE = `${BASE}/suite`;

    // 1. IT HYDRATED. Asserted through something only the client can produce:
    // the first-run window is opened by an effect after reading localStorage,
    // so a page whose scripts were refused never shows it.
    await page.goto(SUITE, { waitUntil: "networkidle" });
    const onboard = await page
      .locator("#onboard-title")
      .innerText({ timeout: 10_000 })
      .catch(() => null);
    note(`  /suite first-run window: ${onboard === null ? "(never appeared)" : JSON.stringify(onboard)}`);
    if (onboard === null) {
      problems.push("[dead] /suite never hydrated: the first-run window is opened by an effect and never opened");
      return;
    }
    reached.add("suite-hydrated");

    // A NUMBER THE EXPORT WOULD REFUSE SAYS SO, on the window where most people
    // type these for the first time. `/` has had this check since 2026-08-25 and
    // the equivalent on this screen had never been driven.
    //
    // The value must be out of range for the field it is typed into: the span
    // accepts up to 200 mm, so a plausible-looking 9.5 proves nothing. Typed
    // into the FOOT, whose bound is 5 mm, and read off the box's own warning
    // rather than a second message elsewhere saying the same thing.
    const foot = page.locator("#set-formedLeadContactMm");
    if (await foot.isVisible().catch(() => false)) {
      await foot.fill("9.5");
      await page.waitForTimeout(400);
      const said = await page.locator(".onboard").innerText().catch(() => "");
      if (/no more than 5 mm/.test(said)) reached.add("suite-range-explained");
      else problems.push(`[silent] an out-of-range first-run setting was dropped without saying why: ${JSON.stringify(said.slice(0, 90))}`);
      await foot.fill("");
      await page.waitForTimeout(200);
    } else {
      problems.push("[gate] the first-run window offered no assembly-line numbers at all");
    }

    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.waitForTimeout(300);
    if (await page.locator("#onboard-title").isVisible().catch(() => false)) {
      problems.push("[gate] the first-run window did not close on Skip");
      return;
    }
    reached.add("suite-first-run-skipped");

    // BLANK SETTINGS DO NOT BLOCK A DATASHEET.
    //
    // Until 2026-08-28 they did, for every part, and the refusal was a line of
    // grey text at the foot of the window while the button stayed bright blue.
    // An engineer testing the product on a plastic SOT-23 invented two ceramic
    // flat pack forming dimensions to get past it.
    //
    // PRESSED, NOT MERELY OFFERED. The first version of this check on `/` passed
    // with the gate deliberately put back, because the gate fires when the
    // button is CLICKED. A file that is not a PDF cannot start a real parse:
    // `/api/parse` refuses it on the bytes, before any model is reached, so the
    // two states are told apart for nothing.
    const junk = join(ROOT, "scratchpad", "not-a-datasheet.pdf");
    writeFileSync(junk, "this is not a PDF");
    expectingJunkUpload = true;
    await page.setInputFiles("#suite-file", junk);
    await page.waitForTimeout(2000);
    const startJunk = page.getByRole("button", { name: /^Read / });
    if (!(await startJunk.isVisible().catch(() => false))) {
      problems.push("[gate] with the forming-die numbers blank, a chosen datasheet offered nothing to press");
    } else {
      await startJunk.click();
      await page.waitForTimeout(3000);
      const said = await page.locator(".suite").innerText().catch(() => "");
      if (/set up your assembly line/i.test(said)) {
        problems.push("[gate] a datasheet was turned away for unset settings");
      } else {
        reached.add("suite-blank-settings-accept-a-datasheet");
      }
    }
    expectingJunkUpload = false;
    // Back to an empty composer for the passes below.
    await page.getByRole("button", { name: "Start another part" }).click().catch(() => {});
    await page.waitForTimeout(400);

    // 2. THE SPICE INTENT IS OFFERABLE AND THE SCREEN FOLLOWS IT.
    //
    // Both halves. A chip that highlights while the rest of the screen still
    // describes a footprint is the "the button's label and what it builds must
    // agree" defect the workspace itself records in a comment.
    await page.getByRole("button", { name: "SPICE model", exact: true }).click();
    await page.waitForTimeout(200);
    const note0 = await page.locator(".frame-note-centred").innerText().catch(() => "");
    if (/specification table/i.test(note0)) reached.add("spice-intent-chosen");
    else problems.push(`[intent] choosing SPICE left the screen describing something else: ${JSON.stringify(note0.slice(0, 80))}`);

    // 3. CHOOSING A DATASHEET MUST NOT CALL A ROUTE THAT DOES NOT EXIST.
    //
    // `/suite` posts every chosen file to `/api/identify` before anything else.
    // The screen catches the failure and carries on, so nothing is visibly
    // broken and every request 404s. A page that quietly depends on a missing
    // route is one refactor away from depending on it loudly.
    const identifyStatuses: number[] = [];
    const watchIdentify = (response: import("playwright").Response) => {
      if (response.url().endsWith("/api/identify")) identifyStatuses.push(response.status());
    };
    page.on("response", watchIdentify);

    // The free pass proves that manufacturer recovery is actually WIRED, not
    // merely that its pure selector has tests. Mock only the external resource
    // boundary: identification, React effects, the GET/POST sequence and File
    // state all remain the production code. The full pass leaves this alone so
    // a mock vendor model cannot change its real generated-model flow.
    const officialRecoveryRoute = "**/api/resources**";
    const officialRecoveryIdentifyRoute = "**/api/identify";
    let officialRecoveryGets = 0;
    let officialRecoveryPosts = 0;
    if (!FULL) {
      await page.route(officialRecoveryIdentifyRoute, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            partNumber: "LMP7704-SP",
            partNumberFrom: "document",
            manufacturer: "Texas Instruments",
            pageCount: 30,
            packages: [],
            specPages: "3–8",
            outlinePage: null,
            sha256: "browser-recovery-fixture",
            fileName: "LMP7704-SP.pdf"
          })
        });
      });
      await page.route(officialRecoveryRoute, async (route) => {
        if (route.request().method() === "GET") {
          officialRecoveryGets += 1;
          // Keep discovery open long enough to observe the interlock. Without
          // this, the mocked manufacturer responds in the same event-loop turn
          // and a browser check can prove the import happened while completely
          // missing a regression that lets the paid read race ahead of it.
          await new Promise((resolve) => setTimeout(resolve, 750));
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ resources: [{ kind: "spice", label: "Official model", url: "https://maker.invalid/LMP7704-SP.lib" }] })
          });
        } else {
          officialRecoveryPosts += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ files: [{ fileName: "LMP7704-SP.lib", source: ".SUBCKT LMP7704-SP INP INM OUT VCC VEE\n.ENDS LMP7704-SP\n" }] })
          });
        }
      });
    }

    const pdf = datasheets()[0];
    await page.setInputFiles("#suite-file", pdf);
    if (!FULL) {
      const recoveryNotice = page.getByText(/Checking official manufacturer artifacts before the read/i);
      const noticeShown = await recoveryNotice.waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      const readDisabled = await page.getByRole("button", { name: "Read for the SPICE model" })
        .isDisabled()
        .catch(() => false);
      if (noticeShown && readDisabled) reached.add("official-recovery-precedes-read");
      else problems.push(`[recovery] the paid read was not held while official manufacturer recovery was active`);
    }
    await page.waitForTimeout(2500);
    page.off("response", watchIdentify);
    if (identifyStatuses.length === 0) {
      reached.add("no-phantom-identify");
    } else if (identifyStatuses.every((code) => code < 400)) {
      reached.add("no-phantom-identify");
    } else {
      problems.push(`[phantom] choosing a datasheet called /api/identify and got ${identifyStatuses.join(", ")}: the route does not exist`);
    }

    if (!FULL) {
      // Measure the operation, not the sentence the screen currently uses for
      // it. The combined CAD/STEP/SPICE importer intentionally has one status
      // message, and grepping an older filename-specific message made a
      // successful POST plus attached File report as a failure. The multipart
      // assertion below independently proves that React retained the result.
      if (officialRecoveryPosts > 0) reached.add("official-resource-auto-imported");
      else {
        const screen = await page.locator(".suite").innerText().catch(() => "");
        problems.push(
          `[recovery] a unique official SPICE artifact was discovered but not imported automatically ` +
          `(resource GET ${officialRecoveryGets}, POST ${officialRecoveryPosts}; screen ${JSON.stringify(screen.slice(0, 180))})`
        );
      }

      // Recovery is worthless if the File shown by React is omitted from the
      // eventual model request. Keep the model boundary mocked (this is the
      // no-spend pass), press the real button, and inspect the real multipart
      // body rather than inferring request state from a filename on screen.
      const modelBodies: string[] = [];
      const modelRoute = "**/api/model";
      await page.route(modelRoute, async (route) => {
        const body = route.request().postData() ?? "";
        modelBodies.push(body);
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ code: "MODEL_INCOMPLETE", error: "No-spend browser fixture stopped before extraction." })
        });
      });
      const read = page.getByRole("button", { name: "Read for the SPICE model" });
      await read.waitFor({ state: "visible", timeout: 2_000 });
      const modelResponse = page.waitForResponse((response) => response.url().endsWith("/api/model"), { timeout: 5_000 });
      await read.click();
      await modelResponse.catch(() => null);
      if (/name="vendorModel"; filename="LMP7704-SP\.lib"/i.test(modelBodies[0] ?? "")) reached.add("official-resource-sent-to-model");
      else problems.push("[recovery] the automatically imported vendor model was not present in the model request");

      // The headline promises that naming a part works too. This used to jump
      // straight to the paid path (so CAD could not choose a package first),
      // and SPICE simply threw "Choose a datasheet". Drive the typed path
      // through free identification, automatic resource recovery, and the
      // multipart model request. The server boundary remains mocked, so it is
      // still free; absence of a `file` field is the signal for `/api/model` to
      // retrieve and verify the public datasheet itself.
      await page.getByRole("button", { name: "Start another part" }).click();
      await page.locator(".frame-input").fill("LMP7704-SP");
      await page.getByRole("button", { name: "Read for SPICE", exact: true }).click();
      const typedRead = page.getByRole("button", { name: "Read for the SPICE model" });
      if (await typedRead.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
        reached.add("typed-part-identified-before-read");
      } else {
        problems.push("[lookup] a typed SPICE part did not reach the identified pre-read state");
      }
      await page.waitForTimeout(1_500);
      const typedResponse = page.waitForResponse((response) => response.url().endsWith("/api/model"), { timeout: 5_000 });
      await typedRead.click();
      await typedResponse.catch(() => null);
      const typedBody = modelBodies[1] ?? "";
      if (
        /name="partNumber"\r?\n\r?\nLMP7704-SP/i.test(typedBody) &&
        /name="vendorModel"; filename="LMP7704-SP\.lib"/i.test(typedBody) &&
        !/name="file";/i.test(typedBody)
      ) {
        reached.add("typed-spice-requested-with-recovery");
      } else {
        problems.push("[lookup] the typed SPICE request did not preserve its part and recovered vendor model without inventing an upload");
      }

      await page.unroute(modelRoute).catch(() => {});
      await page.unroute(officialRecoveryRoute).catch(() => {});
      await page.unroute(officialRecoveryIdentifyRoute).catch(() => {});
      note("  (mocked the model boundary: no model call or spend)");
      return;
    }

    // 4. THE BUTTON. Pressed, and the file it produces opened.
    //
    // Reaching it must not require a CAD read: a SPICE model is built from the
    // DOCUMENT and needs no package, no footprint and no geometry. A flow that
    // spends a CAD parse first is paying twice for one artefact.
    const parseRequests: string[] = [];
    const watchParse = (request: import("playwright").Request) => {
      if (request.url().includes("/api/parse")) parseRequests.push(request.url());
    };
    page.on("request", watchParse);

    // The screen labels this by intent and by how much it knows: "Read for
    // SPICE" with nothing chosen, "Read for the SPICE model" once a file is
    // identified, "Read this datasheet" for CAD with no package picked, "Read
    // for <package>" once one is. Matched on the shared verb rather than on one
    // of them, because a bench that knows only one label reports a missing
    // button when the wording it does not know is the one on screen.
    const read = page.getByRole("button", { name: /^Read / });
    if (!(await read.isVisible().catch(() => false))) {
      problems.push("[spice] with a datasheet chosen there was nothing to press to read it for SPICE");
      return;
    }
    const download = page.waitForEvent("download", { timeout: PARSE_MS + EXPORT_MS }).catch(() => null);
    await read.click();

    // Waited on the BUTTON, not on `footer.status`: `/suite` has no such
    // element, so the shared `settle` would time out on every run and report a
    // screen that never stopped being busy when it had in fact finished. An
    // instrument measuring the wrong element is this repo's most expensive
    // recurring mistake.
    const build = page.getByRole("button", { name: "Take the model", exact: true });
    const blockChoice = page.locator("#spice-block-choice");
    await Promise.race([
      build.waitFor({ state: "visible", timeout: PARSE_MS }),
      blockChoice.waitFor({ state: "visible", timeout: PARSE_MS })
    ]).catch(() => {});
    // A family document may contain several equally applicable grades or test
    // conditions. That is an answerable result, not a failed read: choose the
    // first displayed option only to exercise the UI wiring (the bench makes no
    // claim that it is the user's real grade), then require the rebuilt result.
    if (await blockChoice.isVisible().catch(() => false)) {
      reached.add("spice-block-choice-asked");
      const values = await blockChoice.locator("option").evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter(Boolean)
      );
      if (values.length === 0) {
        problems.push("[spice] a specification-block question offered no choices");
        return;
      }
      await blockChoice.selectOption(values[0]);
      await page.getByRole("button", { name: "Build from this block", exact: true }).click();
      await build.waitFor({ state: "visible", timeout: PARSE_MS }).catch(() => {});
      if (await build.isVisible().catch(() => false)) reached.add("spice-block-choice-answered");
      else problems.push("[spice] answering the specification-block question did not produce a model");
    }
    reached.add("spice-read-ran");

    // THE REVIEW SEAM IS ON THE RESULT, without introducing another step.
    // A source page, editable values, and the exact emitted symbol must all be
    // reachable before a person downloads the archive.
    const parameterReview = page.locator('[data-testid="spice-parameter-review"]');
    if (await parameterReview.isVisible().catch(() => false)) {
      reached.add("spice-parameter-review-shown");
      await parameterReview.locator("summary").click();
      const correct = parameterReview.getByRole("button", { name: "Review or correct" }).first();
      if (await correct.isVisible().catch(() => false)) reached.add("spice-correction-offered");
      else problems.push("[spice] extracted parameters have no page-review correction action");
    } else {
      problems.push("[spice] the result has no extracted-parameter review");
    }
    if (await page.locator('[data-testid="spice-symbol-preview"]').isVisible().catch(() => false)) {
      reached.add("spice-symbol-shown");
    } else {
      problems.push("[spice] the emitted .asy symbol is not drawn on the result");
    }
    if (await page.getByText("Vendor model cross-check", { exact: true }).isVisible().catch(() => false)) {
      reached.add("spice-vendor-check-offered");
    } else {
      problems.push("[spice] the result has no vendor-model cross-check seam");
    }

    if (await build.isVisible().catch(() => false)) {
      if (await build.isDisabled().catch(() => false)) {
        // A SPICE model does not depend on a package being choosable, so a
        // disabled button here is a CAD refusal blocking an unrelated artefact.
        const why = await page.locator(".frame-go .frame-note").innerText().catch(() => "");
        problems.push(`[spice] the model button was disabled: ${JSON.stringify(why.slice(0, 90))}`);
      } else {
        await build.click();
        reached.add("spice-build-pressed");
      }
    } else {
      problems.push("[spice] after reading for SPICE there was no button to build the model");
    }

    page.off("request", watchParse);
    if (parseRequests.length > 0) {
      note(`  /api/parse was called ${parseRequests.length}x on a SPICE-only run`);
      problems.push("[spice] a SPICE run spent a CAD parse it does not need: the model is built from the document");
    }

    const file = await download;
    if (!file) {
      problems.push("[spice] pressing the model button produced no file");
      return;
    }
    const saved = join(ROOT, "scratchpad", `bench-spice-${Date.now()}.zip`);
    await file.saveAs(saved);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(saved));
    const names = Object.keys(zip.files);
    note(`  model bundle: ${names.join(", ")}`);
    // The three artefacts the route promises: a netlist, a symbol, and the
    // receipt that says what was checked. A bundle short one of them is not a
    // model an engineer can use.
    const lib = names.find((n) => n.endsWith(".lib"));
    if (!lib) problems.push(`[spice] the bundle has no .lib netlist: ${names.join(", ")}`);
    if (!names.some((n) => n.endsWith(".asy"))) problems.push(`[spice] the bundle has no .asy symbol: ${names.join(", ")}`);
    if (!names.some((n) => n.includes("conformance"))) problems.push(`[spice] the bundle has no conformance report: ${names.join(", ")}`);
    if (lib) {
      const netlist = await zip.file(lib)!.async("string");
      // A file that parses is not a model. It has to declare the subcircuit and
      // its five terminals, which is the one thing a simulator will refuse on.
      if (/^\.subckt\s+\S+\s+/im.test(netlist)) reached.add("spice-netlist-usable");
      else problems.push("[spice] the netlist has no .subckt line, so no simulator can reference it");
    }
    await suiteCadChecks(page);
    await suiteSpiceMissedParameterChecks(page);
    await suiteVendorRescueChecks(page);
    await suiteConfiguredPrimitiveChecks(page);
    await suiteSpiceAskChecks(page);
  }

  /** A refusal must still accept a general vendor model, including libraries with helpers. */
  async function suiteVendorRescueChecks(page: import("playwright").Page) {
    const pdf = datasheets()[0];
    const vendor = join(tmpdir(), `bench-vendor-rescue-${process.pid}.lib`);
    writeFileSync(vendor, ".subckt HELPER A B\n.ends HELPER\n.subckt PART IN OUT GND\n.ends PART\n");
    await page.goto(`${BASE}/suite`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Skip for now" }).click().catch(() => {});
    await page.getByRole("button", { name: "SPICE model", exact: true }).click();
    await page.setInputFiles("#suite-file", pdf);
    await page.waitForTimeout(1200);

    let requestNumber = 0;
    const matcher = "**/api/model";
    await page.route(matcher, async (route) => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({
          code: "INCOMPLETE_EXTRACTION",
          error: "No generated topology matched.",
          asks: [], correctionNeeds: [], correctionOptions: [], reviewPages: [],
          vendorUploadAccepted: true,
          vendorResource: { label: "Vendor resources", url: "https://example.com", modelKnown: false }
        }) });
      }
      if (requestNumber === 2) {
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({
          code: "VENDOR_SELECTION_REQUIRED",
          error: "Choose the part-level model.",
          vendorCandidates: [
            { id: "subckt:0", kind: "subckt", name: "HELPER", modelType: null, terminals: ["A", "B"] },
            { id: "subckt:1", kind: "subckt", name: "PART", modelType: null, terminals: ["IN", "OUT", "GND"] }
          ]
        }) });
      }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("PART.lib", ".include \"bench-vendor-rescue.lib\"\n.subckt PART P1 P2 P3\n.ends PART\n");
      zip.file("PART.asy", "Version 4\nSymbolType CELL\n");
      zip.file("PART-vendor-structural.txt", "structural only\n");
      const zipBase64 = await zip.generateAsync({ type: "base64" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        fileName: "PART-spice.zip", zipBase64, partNumber: "PART", deviceClass: null,
        deviceClassLabel: "vendor-authored model adapter", suppliedByUser: [],
        block: { scope: null, group: null }, blockChosenBy: "only-one", alternatives: [],
        parameters: [], reviewPages: [], asy: "Version 4\nSymbolType CELL\n",
        vendorResource: null,
        vendorVerification: { status: "checked", error: null, checks: [], simulatorMissing: false, structuralOnly: true, includeName: "bench-vendor-rescue.lib", declaration: ".SUBCKT PART", terminals: ["IN", "OUT", "GND"] },
        checks: [], toCheck: [], overBudget: false
      }) });
    });
    try {
      await page.getByRole("button", { name: /^Read / }).click();
      const choose = page.locator("#vendor-spice-refusal-file");
      await choose.waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
      if ((await choose.count()) === 0) {
        problems.push("[spice-vendor-rescue] a generated-model refusal offered no vendor upload");
        return;
      }
      await choose.setInputFiles(vendor);
      await page.getByRole("button", { name: "Inspect and build adapter" }).click();
      const select = page.locator("#vendor-candidate");
      await select.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (!(await select.isVisible().catch(() => false))) {
        problems.push("[spice-vendor-rescue] a library with helpers did not ask for its part-level declaration");
        return;
      }
      await select.selectOption("subckt:1");
      await page.getByRole("button", { name: "Build adapter for this declaration" }).click();
      const result = page.getByText(/Accepted \.SUBCKT PART/);
      await result.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (await result.isVisible().catch(() => false)) reached.add("spice-vendor-refusal-rescued");
      else problems.push("[spice-vendor-rescue] the selected vendor declaration did not produce a structural result");
    } finally {
      await page.unroute(matcher);
      if (existsSync(vendor)) unlinkSync(vendor);
    }
  }

  /** A usable model card that needs an instance value must ask, not dead-end or guess. */
  async function suiteConfiguredPrimitiveChecks(page: import("playwright").Page) {
    const pdf = datasheets()[0];
    const vendor = join(tmpdir(), `bench-vendor-value-${process.pid}.lib`);
    writeFileSync(vendor, ".model RMOD R(TC1=.001)\n");
    await page.goto(`${BASE}/suite`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Skip for now" }).click().catch(() => {});
    await page.getByRole("button", { name: "SPICE model", exact: true }).click();
    await page.setInputFiles("#suite-file", pdf);
    await page.waitForTimeout(1200);

    let requestNumber = 0;
    const matcher = "**/api/model";
    await page.route(matcher, async (route) => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({
          code: "INCOMPLETE_EXTRACTION", error: "No generated topology matched.", asks: [],
          correctionNeeds: [], correctionOptions: [], reviewPages: [], vendorUploadAccepted: true
        }) });
      }
      if (requestNumber === 2) {
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({
          code: "VENDOR_CONFIGURATION_REQUIRED",
          error: "Supply the instance resistance.",
          vendorConfiguration: { parameter: "resistance" },
          vendorUploadAccepted: true
        }) });
      }
      const posted = route.request().postData() ?? "";
      if (!posted.includes("vendorInstanceValue") || !posted.includes("10k")) {
        problems.push("[spice-vendor-value] the supplied instance value did not reach /api/model");
      }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      zip.file("RESISTOR.lib", "Rvendor P1 P2 RMOD 10k\n");
      zip.file("RESISTOR.asy", "Version 4\nSymbolType CELL\n");
      zip.file("RESISTOR-vendor-structural.txt", "structural only\n");
      const zipBase64 = await zip.generateAsync({ type: "base64" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        fileName: "RESISTOR-spice.zip", zipBase64, partNumber: "RESISTOR", deviceClass: null,
        deviceClassLabel: "vendor-authored model adapter", suppliedByUser: [],
        block: { scope: null, group: null }, blockChosenBy: "only-one", alternatives: [],
        parameters: [], reviewPages: [], asy: "Version 4\nSymbolType CELL\n", vendorResource: null,
        vendorVerification: { status: "checked", error: null, checks: [], simulatorMissing: false, structuralOnly: true, includeName: "bench-vendor-value.lib", declaration: ".MODEL R RMOD", terminals: ["P", "N"] },
        checks: [], toCheck: [], overBudget: false
      }) });
    });
    try {
      await page.getByRole("button", { name: /^Read / }).click();
      const choose = page.locator("#vendor-spice-refusal-file");
      await choose.waitFor({ state: "attached", timeout: 5000 });
      await choose.setInputFiles(vendor);
      await page.getByRole("button", { name: "Inspect and build adapter" }).click();
      const value = page.getByLabel("Instance resistance");
      await value.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (!(await value.isVisible().catch(() => false))) {
        problems.push("[spice-vendor-value] a value-bearing model card did not ask for its instance value");
        return;
      }
      await value.fill("10k");
      await page.getByRole("button", { name: "Inspect and build adapter" }).click();
      const result = page.getByText(/Accepted \.MODEL R RMOD/);
      await result.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (await result.isVisible().catch(() => false)) reached.add("spice-vendor-instance-configured");
      else problems.push("[spice-vendor-value] the configured model card did not produce a structural result");
    } finally {
      await page.unroute(matcher);
      if (existsSync(vendor)) unlinkSync(vendor);
    }
  }

  /**
   * A deterministic browser check for the measured-value recovery seam.
   *
   * The API response is mocked because this is UI wiring, not another paid
   * reading of a datasheet. Route tests separately prove that the real route
   * returns this shape and rebuilds a cited correction.
   */
  async function suiteSpiceMissedParameterChecks(page: import("playwright").Page) {
    const pdf = datasheets()[0];
    await page.goto(`${BASE}/suite`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Skip for now" }).click().catch(() => {});
    await page.getByRole("button", { name: "SPICE model", exact: true }).click();
    await page.setInputFiles("#suite-file", pdf);
    await page.waitForTimeout(1200);

    const matcher = "**/api/model";
    await page.route(matcher, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INCOMPLETE_EXTRACTION",
          error: "This datasheet needs a reviewed open-loop gain.",
          asks: [],
          correctionNeeds: [{ parameter: "openLoopGain" }],
          correctionBlock: { scope: null, group: null },
          reviewPages: [{
            page: 7,
            mimeType: "image/png",
            base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
          }]
        })
      });
    });
    try {
      await page.getByRole("button", { name: /^Read / }).click();
      const review = page.getByRole("button", { name: "Read it from the page" });
      await review.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (!(await review.isVisible().catch(() => false))) {
        problems.push("[spice-review-refusal] a missed measured parameter had no page-backed recovery action");
        return;
      }
      await review.click();
      const unit = page.getByLabel("Printed unit");
      const sourcePage = page.getByLabel("Source page");
      const image = page.locator('.spice-refusal-pages img[alt="Datasheet specification page 7"]');
      if (
        (await unit.isVisible().catch(() => false)) &&
        (await sourcePage.isVisible().catch(() => false)) &&
        (await image.isVisible().catch(() => false))
      ) {
        reached.add("spice-missed-parameter-review");
      } else {
        problems.push("[spice-review-refusal] the recovery action did not show unit, source page, and rendered evidence");
      }
    } finally {
      await page.unroute(matcher);
    }
  }

  /**
   * THE ONE QUESTION THE MODEL BUILD IS ALLOWED TO ASK, driven end to end.
   *
   * A fixed LDO states an output ACCURACY and no nominal, because the voltage is
   * an ordering option: measured 2026-09-04, seven of fourteen regulator
   * datasheets state it nowhere. `/api/model` refuses, returns one question,
   * takes the answer and marks it as supplied everywhere afterwards.
   *
   * None of that screen had ever been loaded. The CAD half learned on
   * 2026-08-29 what that costs: the answer boxes were there, the selector for
   * them matched nothing, and behind it the screen was overwriting the user's
   * answer. This is the same pass, pointed at the panel added afterwards.
   */
  async function suiteSpiceAskChecks(page: import("playwright").Page) {
    const pdf = join(ROOT, ".bench-cache", "LP5907.pdf");
    if (!existsSync(pdf)) {
      note("  (no LP5907 cached, so the SPICE question flow was not driven)");
      return;
    }

    await page.goto(`${BASE}/suite`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    // THE FIRST-RUN WINDOW OPENS ON EVERY FRESH LOAD, and it is modal: leaving
    // it up made every click below time out against a dialog scrim rather than
    // against the screen under test. `suiteCadOn` dismisses it for the same
    // reason; a second pass that navigates has to do the same thing.
    await page
      .getByRole("button", { name: "Skip for now" })
      .click()
      .catch(() => {});
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "SPICE model", exact: true }).click();
    await page.setInputFiles("#suite-file", pdf);
    await page.waitForTimeout(2500);

    const read = page.getByRole("button", { name: /^Read / });
    if (!(await read.isVisible().catch(() => false))) {
      problems.push("[spice-ask] nothing to press to read LP5907 for SPICE");
      return;
    }
    await read.click();

    // THE REFUSAL, AND THE BOX. A refusal with no box is the dead end this
    // exists to catch: the route says the question is answerable and the screen
    // gives nowhere to answer it.
    const box = page.locator("#spice-outputVoltage");
    await box.waitFor({ state: "visible", timeout: PARSE_MS }).catch(() => {});
    if (!(await box.isVisible().catch(() => false))) {
      const said = await page.locator(".refusal").innerText().catch(() => "");
      problems.push(`[spice-ask] LP5907 refused with nowhere to answer: ${JSON.stringify(said.slice(0, 120))}`);
      return;
    }
    reached.add("spice-question-asked");

    // THE REASON, beside the box. A question with no reason reads as the
    // product having failed rather than as the document being silent.
    const why = await page.locator(".ask-why").first().innerText().catch(() => "");
    if (!/ordering option/i.test(why)) {
      problems.push(`[spice-ask] the question does not say why it is being asked: ${JSON.stringify(why.slice(0, 90))}`);
    }

    const use = page.getByRole("button", { name: "Use this", exact: true });
    if (await use.isEnabled().catch(() => false)) {
      problems.push("[spice-ask] the answer button was live with an empty box");
    }

    const download = page.waitForEvent("download", { timeout: PARSE_MS + EXPORT_MS }).catch(() => null);
    await box.fill("3.3");
    await use.click();

    const file = await download;
    if (!file) {
      problems.push("[spice-ask] answering the question produced no file");
      return;
    }
    const saved = join(ROOT, "scratchpad", `bench-spice-ask-${Date.now()}.zip`);
    await file.saveAs(saved);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(readFileSync(saved));
    const lib = Object.keys(zip.files).find((n) => n.endsWith(".lib"));
    if (!lib) {
      problems.push("[spice-ask] the answered bundle has no netlist");
      return;
    }
    const netlist = await zip.file(lib)!.async("string");
    // THE ANSWER REACHED THE MODEL, and is marked as an answer. A citation is a
    // claim that a number is on a page; printing one beside a number a person
    // typed is this product fabricating provenance.
    if (!/3\.3/.test(netlist)) problems.push("[spice-ask] the answer never reached the netlist");
    else if (!/supplied by you, not stated by this datasheet/.test(netlist)) {
      problems.push("[spice-ask] the supplied value is in the netlist and is not marked as supplied");
    } else reached.add("spice-question-answered");

    // And the SCREEN says so too, above the table of verdicts that would
    // otherwise make a check against the user's own number look like evidence.
    const warned = await page.locator(".frame-warn").innerText().catch(() => "");
    if (!/supplied by you/i.test(warned)) {
      problems.push("[spice-ask] the screen shows the checks without saying one value was supplied");
    }
  }

  /**
   * THE CAD FLOW ON `/suite`, which is the screen `/` is about to become.
   *
   * The verdict card, the review list and the question flow were ported into
   * this shell on 2026-09-04 and had never rendered. `/` has had a bench driving
   * them since 2026-08-25 and every defect it found was in one of them, so
   * cutting over without the same pass here would be shipping the panels
   * untested on the screen that ships.
   *
   * Driven on a part that ASKS A QUESTION, because the answering half is the one
   * that was a dead end: `/suite` turned `INPUT_REQUIRED` into a list of labels
   * with nowhere to type.
   */
  async function suiteCadChecks(page: import("playwright").Page) {
    // TWO PARTS, BECAUSE THEY TEST DIFFERENT THINGS.
    //
    // The REQUIRED half - a verdict, a record, and a bundle that opens - runs on
    // a datasheet the reader can finish on its own, so a green run means the CAD
    // path works. The question flow runs on a part that asks, and it is OPTIONAL
    // for the same reason it was optional on `/`: answering a question well takes
    // numbers that make a footprint, and this bench types plausible ones rather
    // than correct ones. A part whose answers do not make a geometry is refused
    // again, correctly, and that is not an application defect.
    await suiteCadOn(page, "AD8628", { required: true });
    await suiteCadOn(page, "RHF1201", { required: false });
  }

  async function suiteCadOn(page: import("playwright").Page, part: string, options: { required: boolean }) {
    const pdf = join(ROOT, ".bench-cache", `${part}.pdf`);
    if (!existsSync(pdf)) {
      note(`  (no ${part} cached: skipping that suite CAD pass)`);
      return;
    }
    note(`\n  --- /suite CAD: ${part} ---`);

    await page.goto(`${BASE}/suite`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Skip for now" }).click().catch(() => {});
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Symbol · footprint · 3D", exact: true }).click();
    await page.setInputFiles("#suite-file", pdf);
    await page.waitForTimeout(3000);

    // Package selection is intentionally explicit: the ordering table tells us
    // what exists, not which physical part the user holds. Exercise that click
    // rather than relying on the first option being silently preselected.
    const packageButtons = page.locator(".packages button");
    if ((await packageButtons.count().catch(() => 0)) > 0) {
      await packageButtons.first().click();
      reached.add("suite-package-chosen");
    }

    const read = page.getByRole("button", { name: /^Read / });
    if (!(await read.isVisible().catch(() => false))) {
      problems.push(`[suite-cad] ${part}: a chosen datasheet offered nothing to read it with`);
      return;
    }
    await read.click();

    // THE VERDICT CARD. `/` has said this after every read since 2026-08-25, and
    // this shell showed a footprint preview with nothing above it saying whether
    // the record could be built at all.
    // `.result` is the card's own container; there is no `.verdict` class. A
    // bench selector that matches nothing reports a missing panel when the
    // panel is there, which is how `bench:browser` once spent a night on the
    // question boxes.
    const card = page.locator(".result").first();
    await card.waitFor({ state: "visible", timeout: PARSE_MS }).catch(() => {});
    if (await card.isVisible().catch(() => false)) {
      reached.add("suite-verdict-shown");
      // WHICH of the card's states this datasheet produced. A screen nobody has
      // opened is a screen nobody has checked, and the list below names them.
      reached.add(`verdict:${verdictState(await card.innerText().catch(() => ""))}`);
    }
    else if (options.required) problems.push(`[suite-cad] ${part}: no verdict was shown after the read`);

    // THE RECORD. A disclosure closed by default, so a body without it still
    // looks finished: `HANDOFF.md` calls it the one panel whose absence would
    // not have been noticed.
    if (await page.locator("details").first().isVisible().catch(() => false)) reached.add("suite-record-shown");
    else if (options.required) problems.push(`[suite-cad] ${part}: the read produced no record panel and no review list`);

    // THE QUESTION FLOW. Answered, not merely displayed: displaying it was
    // exactly the dead end this pass exists to catch.
    const boxes = page.locator(".ask-row input");
    const count = await boxes.count().catch(() => 0);
    if (count === 0) {
      note("  (this datasheet asked nothing, so the bundle can be taken directly)");
      await suiteExportChecks(page, part, options);
      return;
    }
    reached.add("suite-question-asked");

    // ANSWERED UNTIL THERE ARE NONE LEFT, not once.
    //
    // The retry repopulates the list with whatever is STILL missing, so a part
    // needing three numbers walks down to none. Answering one and then trying to
    // export reports "one value is needed" as an export defect when it is the
    // bench having stopped early. The property under test is that the count
    // goes DOWN on every answer: staying the same is the "asks again forever"
    // defect, where an install-wide value overwrites the answer just given.
    // THE PROPERTY IS THAT A QUESTION IS NOT ASKED TWICE, not that the count
    // falls. Answering one number can legitimately reveal another - the export
    // reports what is STILL missing, and a package short of two dimensions
    // surfaces the second only once the first is in hand - so a count that stays
    // at one across two different fields is the flow working. Counting alone
    // reported that as the "asks again forever" defect.
    // A LAND PATTERN IS ASKED FOR AS A GROUP, so the property is PROGRESS and
    // not "never asked twice". The export re-asks length, width and span
    // together until all three are in hand, which is correct: it reports what is
    // still missing, and two of three missing is still missing. What must not
    // happen is a round that answers something and changes nothing.
    // WHAT WAS ACTUALLY SENT. A question that comes back can mean the answer
    // never left the screen or that the route refused it, and only the request
    // body tells them apart.
    const sent: string[] = [];
    const watchExport = (request: import("playwright").Request) => {
      if (!request.url().includes("/api/export")) return;
      const body = request.postData() ?? "";
      const keys = Object.keys(JSON.parse(body || "{}") as Record<string, unknown>).filter((k) => /Mm$|leadSides|leadsPerSide|vacantLeadSlot/.test(k));
      sent.push(keys.join("+") || "(no answers)");
    };
    page.on("request", watchExport);

    const answered = new Map<string, string>();
    let previous = "";
    for (let round = 0; round < 6; round++) {
      const asking = (await boxes.evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).id.replace(/^need-/, ""))).catch(() => [])) as string[];
      if (asking.length === 0) break;
      // A different next question proves the previous answer was accepted even
      // when the bench's merely plausible numbers cannot finish the package.
      // Requiring the whole optional package to export mislabeled successful
      // progress as an unexercised answer path.
      if (previous && asking.join(",") !== previous) reached.add("suite-question-answered");
      note(`  asking: ${asking.join(", ")}`);

      const unanswered = asking.filter((field) => !answered.has(field));
      if (unanswered.length === 0 && asking.join(",") === previous) {
        const said = await page.locator(".frame-status").first().innerText().catch(() => "");
        note(`  export bodies carried: ${sent.join(" | ")}`);
        page.off("request", watchExport);
        // REJECTION IS PROGRESS when the value is wrong. This browser pass uses
        // merely plausible numbers, not a manufacturer oracle. RHF1201 proved
        // why repetition alone cannot diagnose a dropped answer: the request
        // carried 10.16 mm as a land on 0.635 mm pitch, and the route correctly
        // rejected it and left the same boxes available for correction.
        //
        // Accept repetition only when the screen names a physical validation
        // failure. An unexplained repeat is still the lost-answer loop this
        // instrument was built to catch, including on the optional question
        // document.
        const correctionRequested =
          /rejected|misread|would (?:touch|overlap|end|sit)|outside|invalid|needs its own/i.test(said);
        if (correctionRequested) {
          reached.add("suite-question-answered");
          note(`  synthetic answer was safely rejected and the same fields remain available for correction: ${JSON.stringify(said.slice(0, 120))}`);
          return;
        }
        const message = `${part}: every one of ${asking.join(", ")} was answered and all of them were asked again unchanged. Screen says: ${JSON.stringify(said.slice(0, 120))}`;
        problems.push(`[suite-cad] ${message}`);
        return;
      }
      previous = asking.join(",");

      // One round answers every field currently on screen, because the export
      // will not move until the whole group is complete.
      for (const field of unanswered.length > 0 ? unanswered : asking) {
        const box = page.locator(`#need-${field}`);
        if (!(await box.isVisible().catch(() => false))) continue;
        const typed = await answerFor(page, box);
        answered.set(field, typed);
        await box.fill(typed);
        // THE BUTTON IN THE SAME ROW AS THE BOX.
        //
        // `Use this` appears once per question. Pressing the FIRST one after
        // filling the third box submits the first question's value, which the
        // screen has already taken, so nothing changes and every field but one
        // stays unanswered forever. A bench that clicks the wrong control
        // reports the product as looping.
        await page.locator(".ask-row", { has: page.locator(`#need-${field}`) }).getByRole("button").first().click();
        await page.waitForTimeout(8000);
        // The list re-renders after every answer, so the rest of this round's
        // fields are re-located by id rather than held as stale locators.
      }
    }
    page.off("request", watchExport);
    if ((await boxes.count().catch(() => 0)) === 0) {
      reached.add("suite-question-answered");
      await suiteExportChecks(page, part, options);
    } else if (options.required) {
      problems.push(`[suite-cad] ${part}: questions still outstanding after six rounds: answered ${[...answered.keys()].join(", ")}`);
    } else {
      note(`  (${part} still wants ${[...answered.keys()].length} answers this bench could not supply plausibly)`);
    }
  }

  /**
   * THE EXPORT, which is the product.
   *
   * Every format, because a format is a separate emitter and "the export works"
   * measured on one of them is a claim about one emitter. Each is downloaded and
   * OPENED: a zip that arrives and is empty is a failure the status line cannot
   * see, and `bench:browser` has caught exactly that.
   */
  async function suiteExportChecks(page: import("playwright").Page, part: string, options: { required: boolean }) {
    for (const label of ["KiCad", "Altium"]) {
      const format = page.getByRole("radio", { name: new RegExp(label, "i") }).or(page.locator(`input[value="${label.toLowerCase()}"]`));
      await format.first().check().catch(async () => {
        await page.locator(`label:has-text("${label}")`).first().click().catch(() => {});
      });
      await page.waitForTimeout(300);

      const take = page.getByRole("button", { name: /^Take the (library|bundles)/ });
      if (!(await take.isVisible().catch(() => false))) {
        if (options.required) problems.push(`[suite-export] ${part} as ${label}: nothing to press to take the bundle`);
        return;
      }
      if (await take.isDisabled().catch(() => false)) {
        const why = await page.locator(".frame-go .frame-note").innerText().catch(() => "");
        if (options.required) problems.push(`[suite-export] ${part} as ${label}: the button was disabled: ${JSON.stringify(why.slice(0, 90))}`);
        return;
      }

      const download = page.waitForEvent("download", { timeout: EXPORT_MS }).catch(() => null);
      await take.click();
      const file = await download;
      if (!file) {
        const said = await page.locator(".frame-status, .refusal").first().innerText().catch(() => "");
        if (options.required) problems.push(`[suite-export] ${part} as ${label}: pressing the button produced no file. ${said.slice(0, 90)}`);
        return;
      }
      const saved = join(ROOT, "scratchpad", `bench-suite-${label}-${Date.now()}.zip`);
      await file.saveAs(saved);
      const JSZip = (await import("jszip")).default;
      const names = Object.keys((await JSZip.loadAsync(readFileSync(saved))).files);
      note(`  ${label} bundle: ${names.length} entries`);
      // A zip that arrives EMPTY is a failure the status line cannot see.
      if (names.length === 0) problems.push(`[suite-export] ${part} as ${label}: the bundle is empty`);
      else reached.add(`suite-exported:${label.toLowerCase()}`);
    }
  }

  // THE OLD `/` PASS WAS DELETED ON 2026-09-04.
  //
  // It drove `src/app/page.tsx`, which is now a redirect to `/suite`. Six
  // hundred lines of it encoded defects that reached users, and every one of
  // those properties is asserted above against the screen that ships: the CSP
  // hydration check, the settings bound, blank settings not blocking a
  // datasheet, the verdict card, the record, the question loop and a bundle in
  // every format, downloaded and opened.
  //
  // Kept in git rather than in the file. A bench pointed at markup that no
  // longer exists is not coverage, it is a green run that measures nothing,
  // which is the failure this whole file exists to prevent.

async function main() {
  try {
    writeFileSync(LOG, `browser bench, ${new Date().toISOString()}, full=${FULL}\n`);
  } catch {
    // As above.
  }
  if (!existsSync(join(ROOT, ".next"))) {
    console.error("No .next directory. Run `npm run build` first: this checks the PRODUCTION build,");
    console.error("because the defect it exists for was invisible in `next dev`.");
    process.exit(2);
  }

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    console.error("playwright is not installed. `npm i -D playwright && npx playwright install chromium`");
    process.exit(2);
  }

  let server: ChildProcess | undefined;
  let browser: import("playwright").Browser | undefined;
  try {
    // NOBODY ELSE'S SERVER.
    //
    // `next start` binds, fails because the port is taken, and exits - and
    // `waitForServer` then finds a server answering on that port and carries on
    // against WHATEVER IS THERE. On 2026-08-27 that was a `next start` left over
    // from an earlier session, serving an older build: the HTML it returned
    // named chunk hashes that no longer existed on disk, so every asset 400'd
    // and the run reported the app as dead. Eight browser problems, none of them
    // about the code being tested.
    //
    // Same shape as every other entry in `forge-instrument-not-product`: the
    // measurement was of something other than the product, and it read as a
    // catastrophic product defect. Refusing outright is the only safe answer,
    // because a bench that silently measures a stranger cannot be trusted when
    // it is green either.
    if (await respondsOnPort()) {
      console.error(
        `Something is already listening on ${PORT}. This bench starts its own production server and ` +
          `cannot tell yours from its own, so it will not run against it. Stop it and try again.`
      );
      process.exit(2);
    }

    note(`Starting the production server on ${PORT}...`);
    // THE SERVER'S OWN LOG, KEPT.
    //
    // This was `stdio: "ignore"`, so when a route threw, the bench saw a failed
    // click and the stack trace went nowhere. The Altium 500 on 2026-08-24 was
    // found by reading a dev server log, and this bench could not have found
    // it. Anything the server says now lands beside the run.
    const serverLog = openSync(join(ROOT, ".bench-browser-server.log"), "w");
    server = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", serverLog, serverLog],
      env: { ...process.env, PORT: String(PORT) },
      // ITS OWN PROCESS GROUP, so the whole tree can be killed at the end.
      //
      // `npx` is a wrapper: it spawns `next start`, which spawns the server that
      // actually holds the port. Killing the handle we have here kills the
      // wrapper and leaves the grandchild listening, so every run of this bench
      // left a production server behind on 3210. The next run then found the
      // port taken, `next start` exited, and the bench measured the STALE server
      // from the previous run - serving an older build whose chunk hashes no
      // longer exist on disk, which reads as the application being dead.
      //
      // Two bugs, one cause. The guard above refuses to run against a stranger;
      // this stops us creating one.
      detached: true
    });
    if (!(await waitForServer(60_000))) {
      console.error("The production server never came up.");
      stopServer(server);
      process.exit(2);
    }

    try {
      browser = await playwright.chromium.launch();
    } catch (error) {
      console.error("Could not launch a browser. `npx playwright install chromium`");
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    }
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    page.on("console", (message) => {
      // The browser logs a console error for every non-2xx response, including
      // the 422 above, which is not the page doing anything wrong.
      const text = message.text();
      if (message.type() !== "error") return;
      if (/Failed to load resource.*422/.test(text)) return;
      // Same allowance, for the console's echo of the deliberate 400 above, and
      // scoped to the stage rather than to the mode for the same reason as
      // `expectingJunkUpload` itself: a full pass was failing on the echo of its
      // own test fixture after the HTTP-level exemption had already been fixed.
      if (expectingJunkUpload && /Failed to load resource.*400/.test(text)) return;
      problems.push(`[console] ${text}`);
    });
    page.on("pageerror", (error) => problems.push(`[uncaught] ${error.message}`));
    // The export used to be COUNTED here, because "the export did not happen"
    // and "the export happened and failed" are different defects that the status
    // line alone cannot tell apart. The suite pass settles it more directly: it
    // waits for the download event and opens the zip, so an export that did not
    // happen produces no file and an export that failed produces an empty one.
    page.on("requestfailed", (request) => {
      problems.push(`[blocked] ${request.url()} :: ${request.failure()?.errorText}`);
    });
    page.on("response", (response) => {
      // A 422 FROM `/api/export` OR `/api/model` IS A DESIGNED ANSWER, not a
      // fault. It is how those routes say "this is missing and you can supply
      // it", and the screen turns it into the question flow.
      //
      // `/api/resources` uses the same status for a different designed miss:
      // one manufacturer candidate downloaded, but was not a supported archive
      // or contained no usable artifact. Automatic recovery catches that miss
      // and tries the next ranked URL; interactive recovery shows its message.
      // Counting the response itself as an application crash made this gate
      // depend on the transient contents of a live vendor URL. The recovery
      // wiring and successful import are exercised independently in the
      // deterministic no-spend pass. Every other 4xx/5xx remains a finding.
      const designedRefusal =
        response.status() === 422 &&
        (
          response.url().endsWith("/api/export") ||
          response.url().endsWith("/api/model") ||
          response.url().endsWith("/api/resources")
        );
      // AND THE ONE THIS BENCH CAUSES ON PURPOSE. Stage 5 posts a file that is
      // not a PDF, because that is the only way to press Read and learn whether
      // blank settings block it without spending a model call. The route
      // refusing that file is the route working.
      // AND IT IS EXEMPT IN BOTH MODES, which it was not.
      //
      // This read `&& !FULL`, and the junk upload runs in both: so a full pass
      // reported its own deliberate 400 as a browser problem and failed a run in
      // which all fourteen stages passed and every datasheet exported. Scoped by
      // a flag around the stage instead, which exempts exactly that request and
      // leaves every other 4xx on any pass a finding.
      const junkUpload =
        expectingJunkUpload &&
        response.status() === 400 &&
        (response.url().endsWith("/api/parse") || response.url().endsWith("/api/identify"));
      if (response.status() >= 400 && !designedRefusal && !junkUpload) {
        problems.push(`[http ${response.status()}] ${response.url()}`);
      }
    });

    if (ADAPTERS_ONLY) await suiteConfiguredPrimitiveChecks(page);
    else await suiteChecks(page);
  } finally {
    await browser?.close();
    stopServer(server);
  }

  // What MUST happen, kept apart from what a document merely happens to offer.
  //
  // The review panel, the question flow and the chooser only appear where the
  // datasheet produces them, so a run that never sees one is not a failure. It
  // is still printed, because a set of datasheets that quietly stops exercising
  // a path leaves that path unchecked while this bench goes on saying OK.
  const required = ADAPTERS_ONLY
    ? ["spice-vendor-instance-configured"]
    : SPICE
    ? FULL
      ? [
          "suite-hydrated",
          "suite-first-run-skipped",
          "suite-range-explained",
          "suite-blank-settings-accept-a-datasheet",
          "spice-intent-chosen",
          "no-phantom-identify",
          "spice-read-ran",
          "spice-build-pressed",
          "spice-netlist-usable",
          "spice-parameter-review-shown",
          "spice-correction-offered",
          "spice-symbol-shown",
          "spice-vendor-check-offered",
          "spice-vendor-refusal-rescued",
          "spice-vendor-instance-configured",
          "spice-missed-parameter-review",
          // The one question the model build may ask, and the answer reaching
          // the file. Added 2026-09-04 with the panel it drives.
          "spice-question-asked",
          "spice-question-answered",
          // The CAD half of the same screen. Ported on 2026-09-04 and never
          // rendered until this pass existed.
          "suite-verdict-shown",
          "suite-record-shown",
          "suite-exported:kicad",
          "suite-exported:altium"
        ]
      : [
          "suite-hydrated",
          "suite-first-run-skipped",
          "suite-range-explained",
          "suite-blank-settings-accept-a-datasheet",
          "spice-intent-chosen",
          "no-phantom-identify",
          "official-recovery-precedes-read",
          "official-resource-auto-imported",
          "official-resource-sent-to-model",
          "typed-part-identified-before-read",
          "typed-spice-requested-with-recovery"
        ]
    : FULL
    ? [
        "hydrated",
        "settings-shown",
        "range-explained",
        "refusal-keeps-panel-open",
        "settings-saved",
        "blank-settings-accept-a-datasheet",
        "read-is-explicit",
        "progress-shown",
        "parsed",
        "exported:kicad",
        "exported:altium",
        "fits-a-phone",
        "verdict-shown",
        "not-a-wall"
      ]
    : [
        "hydrated",
        "settings-shown",
        "range-explained",
        "refusal-keeps-panel-open",
        "settings-saved",
        "blank-settings-accept-a-datasheet"
      ];
  const optional = SPICE
    ? ["suite-question-asked", "suite-question-answered", "suite-package-chosen"]
    : FULL
    ? [
        "review-confirmed",
        "review-corrected",
        "package-chosen",
        "re-read-warned",
        "question-answered",
        "answered-then-exported",
        "preview-drawn",
        "preview-after-answer",
        "lookup-ran",
        "unready-format-disabled"
      ]
    : [];
  const missed = required.filter((stage) => !reached.has(stage));

  console.log("");
  console.log(`Required stages: ${required.length - missed.length}/${required.length}`);
  if (missed.length > 0) console.log(`  never reached: ${missed.join(", ")}`);
  if (optional.length > 0) {
    const seen = optional.filter((stage) => reached.has(stage));
    console.log(`Paths these datasheets exercised: ${seen.length}/${optional.length}`);
    const unseen = optional.filter((stage) => !reached.has(stage));
    if (unseen.length > 0) console.log(`  NOT exercised by this run: ${unseen.join(", ")}`);

    // THE VERDICT SCREENS THIS RUN OPENED, read off the card's own headline.
    //
    // Reported rather than failed: driving all of them needs a datasheet for
    // each, and some states need a document this corpus may simply not hold.
    // Naming the unseen ones is what stops a screen shipping unopened.
    if (reached.has("verdict:UNRECOGNISED")) {
      problems.push("[verdict] the card showed a headline this bench does not know, so a screen changed without the check");
    }
  }
  console.log(`Browser problems: ${problems.length}`);
  for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);

  if (missed.length > 0 || problems.length > 0) {
    console.log("");
    console.log("FAIL. The app does not run clean in a browser.");
    process.exit(1);
  }
  console.log("");
  console.log("OK. The app loads, hydrates and runs with no browser errors.");
}

// Not top-level `await`: the other benches here run under tsx's CJS output,
// which has no such thing. `void` because the process exits from inside.
void main();
