"use client";

/**
 * ONE FRAME THAT GROWS.
 *
 * ## The shape, and why it is not four screens
 *
 * A session is one part, one read, one output. So the composer is a persistent
 * object rather than a page: on submit it settles to the top and the body grows
 * beneath it - identify, then the read, then the output - each replacing the
 * last INSIDE the same frame. There is exactly one place on screen where the
 * current state lives, and one control that means start over.
 *
 * Rejected: a chat log (history is not the artifact here, and the live content
 * sinks toward the fold), and a back/forward pager (intent and package steer the
 * read, so after it they are not editable; "back" could only mean discard, which
 * is a destructive action wearing a navigation arrow).
 *
 * ## Intent is chosen BEFORE the read, and that is the load-bearing decision
 *
 * The reader is field-directed: it is handed the fields and pages to go after.
 * A footprint wants the package outline drawing and one chosen package; a SPICE
 * model wants the specification table and no package at all, because a
 * macromodel describes the die. Asking afterwards means either over-reading both
 * or re-reading, and a re-read is the most expensive action in the product.
 *
 * Identification is separate and free: a deterministic text pass gives the part
 * number, the manufacturer, the page count and the packages named in the
 * ordering table with no model call. So the user chooses early without choosing
 * blind.
 *
 * ## What is NOT in this file
 *
 * The extraction, review, correction and export rules live in `src/lib` and
 * the API routes. This file owns the shell, the phase machine, and the wiring
 * that makes those shared rules visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FootprintPreview from "../../lib/FootprintPreview";
import SpiceSymbolPreview from "./SpiceSymbolPreview";
import Onboarding from "./Onboarding";
import SettingsPanel from "./SettingsPanel";
import { loadAccount, loadSettings, rememberInstallAnswer, saveAccount, saveSettings, type ForgeAccount } from "./account";
import { answersFromSettings } from "../../lib/settings";
import { AskPanel, RecordPanel, ReviewList, VerdictCard, WorthAGlance } from "../../lib/record-ui";
import { choosableFrom, knownNeedsFor, nothingBuildableIn, packageOutcomesOf, readVerdict } from "../../lib/verdict";
import { answerFor, correctionFor, withField, MAX_FORMED_CONTACT_MM, MAX_LEAD_SPAN_MM } from "../../lib/answers";
import { shownRecord, type ReviewItem } from "../../lib/review";
import { userEdited } from "../../lib/provenance";
import type { ConfidenceCheck } from "../../lib/confidence";
import type { RenderedPage } from "../../lib/pagerender";
import type { Confirmation } from "../../lib/confirm";
import type { AccountDraft } from "./AccountForm";
import { clock, progressAt, searchLine, stagesFor } from "../../lib/readprogress";
import type { Intent } from "../../lib/intent";
import type { ForgeSettings } from "../../lib/settings";
import type { ExportFormat, PartRecord } from "../../lib/types";
import type { FootprintGeometry } from "../../lib/geometry";
import type { PackageChoice, RequiredInput } from "../../lib/exporters";
import { cadElectricalTypeLimitations, cadPendingFindings } from "../../lib/cad-assurance";
import { automaticOfficialImports, recognizedOfficialArtifact } from "../../lib/official-recovery";

export type { Intent };

/**
 * Where the session is. Ordered, and only ever advanced by an action the user
 * took: nothing on this screen moves on its own except the read.
 */
type Phase = "empty" | "identified" | "reading" | "done";

/** The free pass. Deterministic, no model call, about a second. */
interface Identified {
  partNumber: string;
  /**
   * Where the part number came from. `file-name` means nobody read it: it is
   * what the person uploading the file called it, and the screen must not
   * present it as an identification.
   */
  partNumberFrom: "file-name" | "document" | "user-input";
  manufacturer: string | null;
  pageCount: number;
  /** Designators named in the ordering table. Text only: no drawing behind them. */
  packages: Array<{ designator: string; family: string; leadCount: number | null }>;
  specPages: string | null;
  outlinePage: number | null;
  sha256: string;
  fileName: string;
  sourceUrl: string | null;
}

interface OfficialResource {
  kind: "spice" | "cad" | "step" | "package-drawing" | "application-note";
  label: string;
  url: string;
}

interface OfficialImportChoice {
  kind: "cad" | "step" | "spice";
  label: string;
  files: Array<{ fileName: string; source: string }>;
  pinEvidence: string | null;
}

const INTENTS: Array<{ key: Intent; label: string }> = [
  { key: "cad", label: "Symbol · footprint · 3D" },
  { key: "spice", label: "SPICE model" },
  { key: "both", label: "Both" }
];

/**
 * How often the read screen re-renders while it is running.
 *
 * Short enough that the bar is never seen standing still, long enough that it is
 * not a render per frame. The width carries a linear CSS transition of the same
 * length, so the motion between two samples is continuous rather than stepped.
 */
const TICK_MS = 250;

/**
 * The formats, and whether each has a generator behind it.
 *
 * Cadence says "not built" rather than shipping a renamed KiCad file, which is
 * what the whole bundle used to do. Mirrors `formatOptions` in
 * `src/app/page.tsx`; both read `exportFormats` from `src/lib/types.ts`.
 */
const FORMATS: Array<{ value: ExportFormat; label: string; note: string; ready: boolean }> = [
  { value: "kicad", label: "KiCad", note: ".kicad_sym · .kicad_mod · .step", ready: true },
  { value: "altium", label: "Altium", note: ".SchLib · .PcbLib", ready: true },
  { value: "cadence", label: "Cadence / OrCAD", note: "generator not built yet", ready: false }
];

/**
 * Why an export was refused, when it was refused for something nameable.
 *
 * `/api/export` answers with the exact fields rather than a sentence, and the
 * whole argument of the product is that it says which value it could not stand
 * behind. Printing "Export failed" over that would be throwing the answer away.
 */
/**
 * What `/api/model` built, as the screen needs it.
 *
 * The zip is held as the bytes the SERVER assembled, not reassembled here: a
 * second implementation of the bundle is a second thing to drift.
 */
/**
 * The upper bound the input offers, matching the one `/api/model` enforces.
 *
 * Stated in both places because they do different jobs: the route REFUSES a
 * value past it, and the box stops one being typed. `answers.ts` records the
 * same lesson from the CAD half - a bound that only exists on the server is a
 * bound the user discovers by having their answer silently dropped.
 */
const MAX_SUPPLIED_OUTPUT_V = 100;

/** One value `/api/model` will accept from the user, because the page is silent. */
interface SpiceAsk {
  field: string;
  label: string;
  unit: string;
  why: string;
}

/** A measured parameter the reader missed; it may only be supplied from a page. */
interface SpiceCorrectionNeed {
  parameter: string;
}

interface SpiceCorrectionOption {
  deviceClass: string;
  label: string;
  required: string[];
  oneOf: string[];
}

interface SpiceBlockChoice {
  index: number;
  scope: string | null;
  group: string | null;
}

interface VendorCandidate {
  id: string;
  kind: "subckt" | "model";
  name: string;
  modelType: string | null;
  terminals: string[];
  instanceParameter: "resistance" | "capacitance" | "length" | null;
}

interface VendorResource {
  label: string;
  url: string;
  modelKnown: boolean;
}

interface SpiceResult {
  fileName: string;
  zipBase64: string;
  partNumber: string;
  /** Which kind of part it was built as, decided from what the table states. */
  deviceClass: string | null;
  deviceClassLabel: string | null;
  deviceClassChosenBy?: "parameter-contract" | "the-caller-reviewed";
  block: { scope: string | null; group: string | null };
  alternatives: Array<{ scope: string | null; group: string | null }>;
  blockChosenBy: "the-caller-asked" | "caption-names-the-part" | "first-of-several" | "only-one";
  parameters: Array<{ key: string; printed: { min: number | null; typ: number | null; max: number | null }; unit: string; page: number | null; correctedByUser: boolean }>;
  /** Parameters nobody read: the user supplied them because the page is silent. */
  suppliedByUser: string[];
  checks: Array<{ verdict: string; parameter: string; corner: string; expected: number; measured: number | null; errorPct: number | null }>;
  toCheck: Array<{ id: string; label: string; state: string; detail: string; consequence: string | null; page: number | null }>;
  overBudget: boolean;
  reviewPages: RenderedPage[];
  asy: string;
  vendorResource: VendorResource | null;
  vendorVerification: {
    status: "not-supplied" | "checked" | "refused";
    error: string | null;
    checks: Array<{ verdict: string; parameter: string; corner: string; expected: number; measured: number | null; errorPct: number | null }>;
    simulatorMissing: boolean;
    structuralOnly?: boolean;
    includeName?: string;
    declaration?: string;
    terminals?: string[];
  };
}

interface SpiceCorrection {
  parameter: string;
  printed: { min: number | null; typ: number | null; max: number | null };
  unit: string;
  page: number;
  scope?: string | null;
  group?: string | null;
}

interface CorrectionDraft {
  min: string;
  typ: string;
  max: string;
  unit: string;
  page: string;
}

type ExportRefusal =
  | { kind: "needs"; fields: string[] }
  | { kind: "untraceable"; fields: string[] }
  | { kind: "missing"; fields: string[] }
  | { kind: "model"; fields: string[] };

/**
 * One line beside the Read button: what the read is aimed at, and how long.
 *
 * It says what the click costs and what it goes after. The reason the intent is
 * chosen first is in the comment at the top of this file, where it belongs; it
 * was three sentences on screen and the user has to read them every session.
 */
function intentNote(intent: Intent): string {
  if (intent === "cad") return "Pin table and outline drawing. About 90 seconds.";
  if (intent === "spice") return "Specification table. About 90 seconds.";
  return "Both page sets, one pass. About 90 seconds.";
}

/** Keep evidence links inert unless they are an ordinary web URL. */
function evidenceUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export default function SuiteWorkspace() {
  const [phase, setPhase] = useState<Phase>("empty");
  const [intent, setIntent] = useState<Intent>("cad");
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [identified, setIdentified] = useState<Identified | null>(null);
  const [chosenPackage, setChosenPackage] = useState<string | null>(null);
  /** Milliseconds since the read began. Drives the bar and the stage list. */
  const [elapsedMs, setElapsedMs] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // The record, once the read has run. Same shape the existing workspace holds,
  // so every panel in `src/app/page.tsx` can be dropped in unchanged.
  const [part, setPart] = useState<PartRecord | null>(null);
  /**
   * The values no second reading could check.
   *
   * `/api/parse` has always returned these; this shell simply dropped them on
   * the floor, so the one list that states the product's whole argument was
   * missing from the new screen. Nothing new is fetched.
   */
  const [toCheck, setToCheck] = useState<Confirmation[]>([]);
  const [packageChoice, setPackageChoice] = useState<PackageChoice | null>(null);
  const [geometry, setGeometry] = useState<FootprintGeometry | null>(null);
  const [format, setFormat] = useState<ExportFormat>("kicad");
  const [refusal, setRefusal] = useState<ExportRefusal | null>(null);
  /**
   * QUESTIONS THE MODEL BUILD ASKED, and the answers so far.
   *
   * `/api/model` returns these ONLY for a refusal the user can lift. A fixed
   * LDO states an output ACCURACY and no nominal, because the voltage is an
   * ordering option, so seven of fourteen regulator datasheets measured state
   * it nowhere. The product will not decode a part-number suffix into a
   * specification, so it asks - and marks the answer as supplied everywhere it
   * appears afterwards.
   */
  const [spiceAsks, setSpiceAsks] = useState<SpiceAsk[]>([]);
  const [spiceCorrectionNeeds, setSpiceCorrectionNeeds] = useState<SpiceCorrectionNeed[]>([]);
  const [spiceCorrectionOptions, setSpiceCorrectionOptions] = useState<SpiceCorrectionOption[]>([]);
  const [spiceBlockChoices, setSpiceBlockChoices] = useState<SpiceBlockChoice[]>([]);
  const [spiceBlockChoice, setSpiceBlockChoice] = useState("");
  const [spiceReviewDeviceClass, setSpiceReviewDeviceClass] = useState("");
  const [spiceRefusalPages, setSpiceRefusalPages] = useState<RenderedPage[]>([]);
  const [spiceRefusalBlock, setSpiceRefusalBlock] = useState<{ scope: string | null; group: string | null } | null>(null);
  const [spiceAnswers, setSpiceAnswers] = useState<Record<string, string>>({});
  /** The model, once it has been built. Null on a CAD-only run. */
  const [spice, setSpice] = useState<SpiceResult | null>(null);
  const [spiceCorrections, setSpiceCorrections] = useState<SpiceCorrection[]>([]);
  const [editingSpice, setEditingSpice] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft | null>(null);
  const [vendorModel, setVendorModel] = useState<File | null>(null);
  const [vendorCandidates, setVendorCandidates] = useState<VendorCandidate[]>([]);
  const [vendorCandidate, setVendorCandidate] = useState<string>("");
  const [vendorInstanceParameter, setVendorInstanceParameter] = useState<VendorCandidate["instanceParameter"]>(null);
  const [vendorInstanceValue, setVendorInstanceValue] = useState("");
  const [spiceVendorResource, setSpiceVendorResource] = useState<VendorResource | null>(null);
  const [vendorUploadAccepted, setVendorUploadAccepted] = useState(false);
  const [spiceDirty, setSpiceDirty] = useState(false);
  const [vendorCad, setVendorCad] = useState<File | null>(null);
  const [vendorCadPinEvidence, setVendorCadPinEvidence] = useState<string | null>(null);
  const [vendorStep, setVendorStep] = useState<File | null>(null);
  const [officialResources, setOfficialResources] = useState<OfficialResource[]>([]);
  const [officialImportChoices, setOfficialImportChoices] = useState<OfficialImportChoice[]>([]);
  // The part a lookup is running for, and when it started. Null when no search
  // is in flight, which is what makes `searchLine` show only while it should.
  const [searching, setSearching] = useState<{ part: string; since: number } | null>(null);
  const [searchElapsedMs, setSearchElapsedMs] = useState(0);
  const [discoveringOfficial, setDiscoveringOfficial] = useState(false);
  const [importingOfficial, setImportingOfficial] = useState(false);
  const attemptedOfficialImports = useRef(new Set<string>());
  const officialResourceIdentity = useRef("");

  // Resource discovery is recovery work, so it runs without making the user
  // press another button. A failed vendor page is silent and never blocks the
  // datasheet path that is already in progress.
  useEffect(() => {
    const partNumber = identified?.partNumber || part?.partNumber.value || "";
    const manufacturer = identified?.manufacturer || part?.manufacturer.value || "";
    if (!partNumber || !manufacturer) {
      setOfficialResources([]);
      setDiscoveringOfficial(false);
      return;
    }
    const identity = `${manufacturer}\u0000${partNumber}`;
    if (officialResourceIdentity.current !== identity) {
      officialResourceIdentity.current = identity;
      attemptedOfficialImports.current.clear();
      setOfficialResources([]);
    }
    const controller = new AbortController();
    setDiscoveringOfficial(true);
    void fetch(`/api/resources?partNumber=${encodeURIComponent(partNumber)}&manufacturer=${encodeURIComponent(manufacturer)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { resources: [] })
      .then((payload) => setOfficialResources(Array.isArray(payload.resources) ? payload.resources : []))
      .catch(() => undefined)
      .finally(() => {
        if (officialResourceIdentity.current === identity) setDiscoveringOfficial(false);
      });
    return () => controller.abort();
  }, [identified?.partNumber, identified?.manufacturer, part?.partNumber.value, part?.manufacturer.value]);

  /**
   * EVERYTHING THE READ RETURNED THAT THIS SHELL USED TO DROP.
   *
   * `/api/parse` has always sent all of it. The shell kept `part` and
   * `toCheck` and threw the rest away, so the review list, the page images, the
   * confidence checks and the outline drawing's page had nowhere to render.
   * Nothing new is fetched: this is a rendering job, as `HANDOFF.md` says.
   */
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [checks, setChecks] = useState<ConfidenceCheck[]>([]);
  const [pageImages, setPageImages] = useState<RenderedPage[]>([]);
  const [drawingPage, setDrawingPage] = useState<number | null>(null);
  /** Questions the export ASKED, which outrank the ones we knew about. */
  const [pendingNeeds, setPendingNeeds] = useState<RequiredInput[]>([]);
  const [needValues, setNeedValues] = useState<Record<string, string>>({});
  /** Answers given for THIS part, sent on every retry. */
  const [supplied, setSupplied] = useState<Record<string, number | string>>({});

  /**
   * THE INSTALLATION, READ ONCE ON MOUNT.
   *
   * `ready` is not decoration. Both stores live in `localStorage`, which the
   * server render cannot see, so before the effect runs "no account" and "not
   * looked yet" are the same value. Opening the first-run window on that would
   * flash it at a user who already has an account, every single visit.
   */
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<ForgeAccount | null>(null);
  const [settings, setSettings] = useState<ForgeSettings>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Closed by hand this session, with no account created.
   *
   * The window opens itself until an account exists, and it must still be
   * possible to walk past it: the 2026-08-28 finding is that a first-run screen
   * a user cannot answer honestly gets answered dishonestly. Dismissing lasts
   * for the session and it comes back next visit, because the question is real.
   */
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);

  useEffect(() => {
    setAccount(loadAccount());
    setSettings(loadSettings());
    setReady(true);
  }, []);

  const fileInput = useRef<HTMLInputElement | null>(null);
  const needsPackage = intent !== "spice";
  const firstRunOpen = ready && account === null && !firstRunDismissed;

  /** Every change on the first-run window is persisted, so leaving by any route keeps it. */
  const changeSettings = useCallback((next: ForgeSettings) => {
    // The REJECTION is not reported here, and that is not an omission.
    // `AssemblyForm` marks the offending box `aria-invalid` and prints the bound
    // beneath it as the number is typed, which is nearer the box than a line at
    // the foot of the window and arrives sooner. A second message saying the
    // same thing in different words is what `bench:browser` has twice caught on
    // the other screen. Checked by the suite pass.
    setSettings(saveSettings(next).settings);
  }, []);

  const createAccount = useCallback((draft: AccountDraft) => {
    setAccount(saveAccount(draft, null));
  }, []);

  /**
   * IDENTIFY, WHICH IS FREE.
   *
   * Deterministic and model-free, so it runs the moment a file lands and its
   * result is what makes the intent choice informed rather than blind. It must
   * stay free: the moment this needs a model call it belongs behind the Read
   * button with everything else that costs money.
   *
   * `/api/identify` exposes the text pass that `/api/parse` runs first:
   * part number, manufacturer, page count and ordering-table designators,
   * returned without the model leg.
   */
  const identify = useCallback(async (chosen: File) => {
    setBusy(true);
    setStatus(`Identifying ${chosen.name}…`);
    try {
      const body = new FormData();
      body.append("file", chosen);
      const response = await fetch("/api/identify", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not read this file.");
      setDiscoveringOfficial(Boolean(payload.partNumber && payload.manufacturer));
      setIdentified(payload as Identified);
      // A datasheet can list several physical packages but cannot say which one
      // the user holds. Leave that choice explicit; preselecting the first
      // ordering-table row silently chose a footprint on the user's behalf.
      setChosenPackage(null);
      setPhase("identified");
      setStatus("");
    } catch (error) {
      // A file we cannot identify is not a file we refuse: the model pass may
      // still read it. The screen says so rather than dead-ending.
      setStatus(error instanceof Error ? error.message : "Could not identify this file.");
      setIdentified(null);
      setPhase("identified");
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * The same free deterministic identification for a typed part number.
   * Retrieval is network work but not model work: it finds and verifies the
   * public PDF, returns package choices, and lets official-artifact recovery
   * finish before the user starts the paid read.
   */
  const identifyPrompt = useCallback(async () => {
    const partNumber = prompt.trim();
    if (!partNumber) return;
    setBusy(true);
    setSearching({ part: partNumber, since: Date.now() });
    setStatus(`Finding ${partNumber}…`);
    try {
      const response = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumber })
      });
      const payload = await response.json();
      if (!response.ok) {
        // NOT FOUND IS SAID ONCE, BY THE PANEL, NOT TWICE.
        //
        // The panel below this line already reads "No datasheet found. Retry
        // below, or upload the PDF.", so echoing the route's own sentence here
        // put the same fact on screen twice, an inch apart, one of them naming
        // a part number the composer is already showing.
        //
        // Every OTHER failure keeps its message, because each says something
        // the panel does not: a transport failure that is worth retrying, a
        // document that was found but is for another part, lookup disabled in
        // air-gapped mode, a rate limit. Those are different actions, and
        // silencing them would leave the panel's generic line standing in for
        // all of them.
        setIdentified(null);
        setPhase("identified");
        setStatus(payload.code === "DATASHEET_NOT_FOUND" ? "" : payload.error || "Could not identify this part.");
        return;
      }
      setDiscoveringOfficial(Boolean(payload.partNumber && payload.manufacturer));
      setIdentified(payload as Identified);
      setChosenPackage(null);
      setPhase("identified");
      setStatus("");
    } catch (error) {
      // Keep the typed part and the PDF-upload escape hatch. The full lookup
      // remains available from this state in case a transient identification
      // request, rather than the document itself, failed. This is now reached
      // only by a thrown request or a body that would not parse, never by a
      // route answering with an error the block above already handled.
      setIdentified(null);
      setPhase("identified");
      setStatus(error instanceof Error ? error.message : "Could not identify this part.");
    } finally {
      // Cleared on EVERY exit, including the early return above, so a finished
      // search can never leave a line claiming it is still looking.
      setSearching(null);
      setBusy(false);
    }
  }, [prompt]);

  const onPick = useCallback(
    (chosen: File | null) => {
      if (!chosen) return;
      setFile(chosen);
      void identify(chosen);
    },
    [identify]
  );

  const selectOfficialFile = useCallback((kind: "cad" | "step" | "spice", candidate: { fileName: string; source: string }, pinEvidence: string | null = null) => {
    const imported = new File([candidate.source], candidate.fileName, { type: "text/plain" });
    if (kind === "cad") {
      setVendorCad(imported);
      setVendorCadPinEvidence(pinEvidence);
      setStatus(`${imported.name} is ready; Forge will validate it when the CAD bundle is built.`);
    } else if (kind === "step") {
      setVendorStep(imported);
      setStatus(`${imported.name} is ready; Forge will validate and preserve the manufacturer 3D model.`);
    } else {
      setVendorModel(imported);
      setVendorCandidates([]);
      setVendorCandidate("");
      setVendorInstanceParameter(null);
      setVendorInstanceValue("");
      setSpiceDirty(true);
      setStatus(`${imported.name} is ready to check as the vendor model.`);
    }
    setOfficialImportChoices((choices) => choices.filter((choice) => choice.kind !== kind));
  }, []);

  const useOfficialResource = useCallback(async (resource: OfficialResource, silentFailure = false): Promise<boolean> => {
    const manufacturer = identified?.manufacturer || part?.manufacturer.value || "";
    if (!manufacturer) return false;
    const identityAtStart = officialResourceIdentity.current;
    setImportingOfficial(true);
    if (!silentFailure) setStatus(`Importing ${resource.label} from the manufacturer…`);
    try {
      const response = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: resource.url, manufacturer })
      });
      const payload = await response.json();
      // A user can start another part while a manufacturer archive is in
      // flight. Never attach the old part's copper/model to the new session.
      if (officialResourceIdentity.current !== identityAtStart) return false;
      if (!response.ok) throw new Error(payload.error || "The official resource could not be imported.");
      const files = (Array.isArray(payload.files) ? payload.files : []) as Array<{ fileName: string; source: string }>;
      const spiceFiles = files.filter((candidate) => /\.(?:lib|cir|sub|mod|ckt|sp|spi|inc|txt)$/i.test(candidate.fileName));
      const cadFiles = files.filter((candidate) => /\.(?:kicad_mod|lbr)$/i.test(candidate.fileName));
      const stepFiles = files.filter((candidate) => /\.(?:step|stp)$/i.test(candidate.fileName));
      if (spiceFiles.length + cadFiles.length + stepFiles.length === 0) {
        throw new Error("That official resource has no format Forge can import yet.");
      }
      const symbols = files.filter((candidate) => candidate.fileName.toLowerCase().endsWith(".kicad_sym"));
      const recognizedSymbol = recognizedOfficialArtifact(symbols, "cad", {
        partNumber: identified?.partNumber || part?.partNumber.value
      });
      const pinEvidence = recognizedSymbol?.source ?? null;
      const identity = {
        partNumber: identified?.partNumber || part?.partNumber.value,
        packageType: chosenPackage || part?.packageType.value
      };
      const groups: Array<{ kind: "cad" | "step" | "spice"; files: Array<{ fileName: string; source: string }> }> =
        resource.kind === "spice"
          ? [{ kind: "spice", files: spiceFiles }]
          : [{ kind: "cad", files: cadFiles }, { kind: "step", files: stepFiles }];
      const choices: OfficialImportChoice[] = [];
      for (const group of groups) {
        if (group.files.length === 0) continue;
        const recognized = recognizedOfficialArtifact(group.files, group.kind, identity);
        if (recognized) {
          const imported = new File([recognized.source], recognized.fileName, { type: "text/plain" });
          if (group.kind === "cad") {
            setVendorCad(imported);
            setVendorCadPinEvidence(pinEvidence);
          } else if (group.kind === "step") {
            setVendorStep(imported);
          } else {
            setVendorModel(imported);
            setVendorCandidates([]);
            setVendorCandidate("");
            setVendorInstanceParameter(null);
            setVendorInstanceValue("");
            setSpiceDirty(true);
          }
        } else {
          choices.push({ kind: group.kind, label: resource.label, files: group.files, pinEvidence });
        }
      }
      setOfficialImportChoices((current) => [
        ...current.filter((choice) => !groups.some((group) => group.kind === choice.kind)),
        ...choices
      ]);
      setStatus(choices.length > 0
        ? `The manufacturer supplied several candidates. Choose the files named for your selected package or model.`
        : "Forge imported the manufacturer artifacts and will validate them during the build.");
      return true;
    } catch (error) {
      if (!silentFailure) setStatus(error instanceof Error ? error.message : "The official resource could not be imported.");
      return false;
    } finally {
      setImportingOfficial(false);
    }
  }, [identified?.manufacturer, identified?.partNumber, part?.manufacturer.value, part?.partNumber.value, part?.packageType.value, chosenPackage, selectOfficialFile]);

  const automaticImportsWaiting = useMemo(
    () => automaticOfficialImports(
      officialResources,
      intent,
      {
        cad: vendorCad !== null || officialImportChoices.some((choice) => choice.kind === "cad"),
        step: vendorStep !== null || officialImportChoices.some((choice) => choice.kind === "step"),
        spice: vendorModel !== null || officialImportChoices.some((choice) => choice.kind === "spice")
      },
      attemptedOfficialImports.current
    ),
    [officialResources, intent, vendorCad, vendorStep, vendorModel, officialImportChoices, importingOfficial]
  );

  // DISCOVERY WITHOUT AUTOMATIC IMPORT WAS STILL A USER TASK. Once the
  // manufacturer has supplied a ranked direct artifact, Forge tries it inside
  // the same job. Failed candidates stay invisible and the next official URL
  // is attempted; archives with several usable files stop at the existing
  // recognition-based chooser because choosing a package/model is user-owned.
  useEffect(() => {
    if (officialResources.length === 0 || importingOfficial) return;
    const queue = automaticImportsWaiting;
    if (queue.length === 0) return;
    let cancelled = false;
    void (async () => {
      const completed = new Set<"cad" | "step" | "spice">();
      for (const resource of queue) {
        if (cancelled) break;
        if (resource.kind !== "cad" && resource.kind !== "step" && resource.kind !== "spice") continue;
        if (completed.has(resource.kind)) continue;
        attemptedOfficialImports.current.add(resource.url);
        if (await useOfficialResource(resource, true)) completed.add(resource.kind);
      }
    })();
    return () => { cancelled = true; };
  }, [officialResources, importingOfficial, automaticImportsWaiting, useOfficialResource]);

  /**
   * THE READ. Ninety seconds and one model call, begun on purpose.
   *
   * `packageType` is sent BEFORE the read rather than after, because every pin
   * reader takes the package as an argument.
   *
   * ## `intent` does NOT aim the read, and this used to say it did
   *
   * It reads "`intent` decides the field set and the pages to render" until
   * 2026-09-10, and neither route has ever looked at it: `lookupSchema` does not
   * declare it so zod strips it, `/api/parse` never reads the form field, and
   * `runExtraction` takes no field set at all. The read is aimed by
   * `unresolvedFields`, the GAPS in the record, so "Read for CAD" and "Read for
   * both" ask for the same thing and cost the same.
   *
   * So it is no longer sent. What `intent` does do is all client-side and real:
   * it routes SPICE to `/api/model` instead of here, decides whether a package
   * must be chosen, picks the progress stages, and narrows which official
   * manufacturer artifacts are worth recovering. Wiring it into the read would
   * mean changing the prompt, which is not free, and nothing has measured that
   * a narrower ask reads better.
   */
  const runRead = useCallback(async () => {
    // A BACKSTOP, not the control. Both callers already guarantee this: the
    // primary button sends a retry to `identifyPrompt` instead, and the
    // re-read link requires a file. It is here because the cost of getting it
    // wrong is the reading screen asserting that a datasheet is being parsed
    // when none was ever found.
    if (!file && !identified) return;
    setPhase("reading");
    setBusy(true);
    setElapsedMs(0);
    const started = Date.now();
    const tick = window.setInterval(() => setElapsedMs(Date.now() - started), TICK_MS);

    try {
      // A SPICE MODEL IS BUILT FROM THE DOCUMENT, SO THIS DOES NOT PARSE FOR CAD.
      //
      // Until 2026-09-04 a SPICE run went through `/api/parse` first - a full
      // CAD extraction, one model call and about ninety seconds - purely to
      // populate a part number, and then posted the same PDF to `/api/model`,
      // which reads the document again. Two reads and two waits for one
      // artefact, one of them for a footprint nobody asked for. Worse, the
      // build button was then disabled whenever that CAD read could not settle
      // on a package, so a footprint problem blocked a model that does not have
      // a footprint. Found by `bench:browser --spice`.
      if (intent === "spice") {
        const body = modelRequest(identified?.partNumber || file?.name || prompt.trim(), spiceAnswers);
        const response = await fetch("/api/model", { method: "POST", body });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          // The refusal names what the DOCUMENT does not state. It is not a
          // generic failure and must not be shown as one. Where the user can
          // lift it by answering, the questions come back with it.
          setRefusal({ kind: "model", fields: [String(payload.error ?? "This datasheet does not state enough to build a model.")] });
          setSpiceAsks((payload.asks as SpiceAsk[]) ?? []);
          setSpiceBlockChoices((payload.blockChoices as SpiceBlockChoice[]) ?? []);
          setSpiceBlockChoice("");
          setSpiceCorrectionNeeds((payload.correctionNeeds as SpiceCorrectionNeed[]) ?? []);
          setSpiceCorrectionOptions((payload.correctionOptions as SpiceCorrectionOption[]) ?? []);
          setSpiceRefusalPages((payload.reviewPages as RenderedPage[]) ?? []);
          setSpiceRefusalBlock((payload.correctionBlock as { scope: string | null; group: string | null } | null) ?? null);
          setSpiceVendorResource((payload.vendorResource as VendorResource | null) ?? null);
          setVendorUploadAccepted(Boolean(payload.vendorUploadAccepted) || payload.code === "VENDOR_SELECTION_REQUIRED");
          setVendorCandidates((payload.vendorCandidates as VendorCandidate[]) ?? []);
          setVendorInstanceParameter((payload.vendorConfiguration as { parameter?: VendorCandidate["instanceParameter"] } | undefined)?.parameter ?? null);
          // This is a completed read with an answerable result, not a return to
          // the pre-read screen. The refusal and its inputs live in the done
          // body, so moving back to `identified` hid both and left the user
          // with the same Read button they had already pressed.
          setPhase("done");
          setStatus("");
          return;
        }
        setSpiceAsks([]);
        setSpiceCorrectionNeeds([]);
        setSpiceCorrectionOptions([]);
        setSpiceBlockChoices([]);
        setSpiceBlockChoice("");
        setSpiceRefusalPages([]);
        setSpiceRefusalBlock(null);
        setVendorCandidates((payload.vendorCandidates as VendorCandidate[]) ?? []);
        setVendorInstanceParameter(null);
        setVendorInstanceValue("");
        setSpice(payload as unknown as SpiceResult);
        setSpiceDirty(false);
        setPhase("done");
        setStatus("");
        return;
      }

      let payload: Record<string, unknown>;
      if (file) {
        const body = new FormData();
        body.append("file", file);
        if (needsPackage && chosenPackage) body.append("packageType", chosenPackage);
        body.append("settings", JSON.stringify(settings));
        const response = await fetch("/api/parse", { method: "POST", body });
        payload = await response.json();
        if (!response.ok) throw new Error((payload.error as string) || "Could not read that datasheet.");
      } else {
        const response = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partNumber: prompt.trim(),
            ...(needsPackage && chosenPackage ? { packageType: chosenPackage } : {}),
            settings
          })
        });
        payload = await response.json();
        if (!response.ok) throw new Error((payload.error as string) || "Could not find that datasheet.");
      }

      setPart(payload.part as PartRecord);
      setToCheck((payload.toCheck as Confirmation[]) ?? []);
      // The read returns all of this and the shell used to drop it on the floor.
      setReview((payload.review as ReviewItem[]) ?? []);
      setChecks((payload.checks as ConfidenceCheck[]) ?? []);
      setPageImages((payload.reviewPages as RenderedPage[]) ?? []);
      setDrawingPage((payload.packageDrawing as { page?: number } | null)?.page ?? null);
      setPendingNeeds([]);
      setSupplied({});
      setPackageChoice((payload.packageChoice as PackageChoice) ?? null);
      const choice = payload.packageChoice as PackageChoice | undefined;
      const option = choice?.ok
        ? choice.options.find((o) => o.designator === chosenPackage) ?? choice.options[0]
        : undefined;
      setGeometry(option?.geometry ?? null);
      setPhase("done");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The read failed.");
      setPhase("identified");
    } finally {
      window.clearInterval(tick);
      setBusy(false);
    }
  // `modelRequest` is declared later in the component and closes over the
  // vendor artifact and its configuration. List those inputs here explicitly:
  // after automatic recovery attaches a model, this callback must be recreated
  // or the paid read would run with the pre-recovery FormData it captured.
  }, [
    file,
    prompt,
    intent,
    needsPackage,
    chosenPackage,
    settings,
    identified?.partNumber,
    identified?.manufacturer,
    vendorModel,
    vendorCandidate,
    vendorInstanceValue,
    spiceCorrections,
    spiceReviewDeviceClass,
    spiceBlockChoice,
    spiceAnswers
  ]);

  /**
   * TAKE THE BUNDLE. This button had no `onClick` at all.
   *
   * It rendered enabled, in the primary colour, at the end of the flow, and did
   * nothing when pressed: the shell was built with the export wiring left for
   * the functionality merge and nothing on screen said so. A primary action that
   * silently refuses is the defect written up on 2026-08-28 in its purest form,
   * and here it was not even refusing, it was ignoring.
   *
   * Ported from `handleExport` in `src/app/page.tsx`, keeping the parts that
   * carry a reason. The ORDER of the spread is load-bearing and is why this is a
   * port rather than a fresh call: install-scoped answers first so a remembered
   * forming die is sent on an export nobody answered anything for this time,
   * then the settings. Reversing those two made a question unanswerable, which
   * took a browser session to find.
   */
  /**
   * The SPICE half, which is a different artefact from a different input.
   *
   * A model is built from the DOCUMENT, not from the record, so it posts the
   * PDF to `/api/model`. Until this existed the format picker was hidden for a
   * SPICE intent, `format` kept its `"kicad"` default, and the button labelled
   * "Take the model" silently built a KiCad library. That is worse than the
   * 2026-08-28 silence: it is a wrong answer delivered confidently.
   */
  /**
   * Hands over the bundle the read already built.
   *
   * It does NOT build it again. The read is what costs the ninety seconds, and
   * a button that silently repeats it would charge twice for one answer and
   * could hand over a different one, because the two calls are two readings.
   *
   * On a `both` run the model has not been built yet, since that path goes
   * through the CAD parse; there it builds on demand.
   */
  /**
   * THE ONE PLACE THE MODEL REQUEST IS BUILT.
   *
   * Two call sites posted to `/api/model` with hand-built form data, which is
   * two places to add a field to and one of them to forget. The supplied
   * answers are exactly such a field.
   */
  const modelRequest = useCallback(
    (
      name: string,
      answers: Record<string, string>,
      cadBundle?: Blob | null,
      corrections: SpiceCorrection[] = spiceCorrections
    ) => {
      const body = new FormData();
      if (file) body.append("file", file);
      body.append("partNumber", name);
      body.append("response", "json");
      const manufacturer = identified?.manufacturer;
      if (manufacturer) body.append("manufacturer", manufacturer);
      if (cadBundle) body.append("cadBundle", cadBundle, "cad-forge.zip");
      if (vendorModel) body.append("vendorModel", vendorModel, vendorModel.name);
      if (vendorCandidate) body.append("vendorCandidate", vendorCandidate);
      if (vendorInstanceValue.trim()) body.append("vendorInstanceValue", vendorInstanceValue.trim());
      if (corrections.length > 0) body.append("corrections", JSON.stringify(corrections));
      if (spiceReviewDeviceClass) body.append("reviewDeviceClass", spiceReviewDeviceClass);
      if (spiceBlockChoice !== "") body.append("blockChoice", spiceBlockChoice);
      for (const [field, raw] of Object.entries(answers)) {
        const value = raw.trim();
        if (value !== "") body.append(`supplied.${field}`, value);
      }
      return body;
    },
    [file, identified, vendorModel, vendorCandidate, vendorInstanceValue, spiceCorrections, spiceReviewDeviceClass, spiceBlockChoice]
  );

  const takeTheModel = useCallback(async (
    cadBundle?: Blob | null,
    download = true,
    corrections: SpiceCorrection[] = spiceCorrections
  ) => {
    if (spice && !cadBundle && download && !spiceDirty) {
      const bytes = Uint8Array.from(atob(spice.zipBase64), (c) => c.charCodeAt(0));
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = spice.fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setStatus("Downloaded, with the conformance report beside it.");
      return;
    }
    if (!file) return;
    setBusy(true);
    setRefusal(null);
    setStatus("Building the SPICE model and checking it against the datasheet…");
    try {
      const body = modelRequest(part?.partNumber.value || identified?.partNumber || file.name, spiceAnswers, cadBundle, corrections);
      const response = await fetch("/api/model", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        setRefusal({ kind: "model", fields: [String(payload?.error ?? "This datasheet does not state enough to build a model.")] });
        setSpiceAsks((payload?.asks as SpiceAsk[]) ?? []);
        setSpiceBlockChoices((payload?.blockChoices as SpiceBlockChoice[]) ?? []);
        setSpiceBlockChoice("");
        setSpiceCorrectionNeeds((payload?.correctionNeeds as SpiceCorrectionNeed[]) ?? []);
        setSpiceCorrectionOptions((payload?.correctionOptions as SpiceCorrectionOption[]) ?? []);
        setSpiceRefusalPages((payload?.reviewPages as RenderedPage[]) ?? []);
        setSpiceRefusalBlock((payload?.correctionBlock as { scope: string | null; group: string | null } | null) ?? null);
        setSpiceVendorResource((payload?.vendorResource as VendorResource | null) ?? spiceVendorResource);
        setVendorUploadAccepted(Boolean(payload?.vendorUploadAccepted) || payload?.code === "VENDOR_SELECTION_REQUIRED" || vendorUploadAccepted);
        setVendorCandidates((payload?.vendorCandidates as VendorCandidate[]) ?? []);
        setVendorInstanceParameter((payload?.vendorConfiguration as { parameter?: VendorCandidate["instanceParameter"] } | undefined)?.parameter ?? null);
        setStatus("");
        return;
      }
      setSpiceAsks([]);
      setSpiceCorrectionNeeds([]);
      setSpiceCorrectionOptions([]);
      setSpiceBlockChoices([]);
      setSpiceBlockChoice("");
      setSpiceRefusalPages([]);
      setSpiceRefusalBlock(null);
      setVendorCandidates((payload?.vendorCandidates as VendorCandidate[]) ?? []);
      setVendorInstanceParameter(null);
      setVendorInstanceValue("");
      if (!Array.isArray(payload?.vendorCandidates) || payload.vendorCandidates.length === 0) setVendorCandidate("");
      const built = payload as unknown as SpiceResult;
      setSpice(built);
      setSpiceDirty(false);
      if (download) {
        const bytes = Uint8Array.from(atob(built.zipBase64), (c) => c.charCodeAt(0));
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = built.fileName;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
        setStatus("Downloaded, with the conformance report beside it.");
      } else {
        setStatus(
          built.vendorVerification.structuralOnly
            ? "Vendor adapter built. Check its displayed terminal order before use."
            : vendorModel
              ? "Model rebuilt and the supplied vendor model checked."
              : "Model rebuilt from your reviewed values."
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The model build failed.");
    } finally {
      setBusy(false);
    }
  }, [spice, part, file, identified, modelRequest, spiceAnswers, spiceCorrections, spiceDirty, vendorModel, spiceVendorResource, vendorUploadAccepted]);

  const takeTheBundle = useCallback(async (
    answers: Record<string, number | string> = supplied,
    download = true
  ): Promise<Blob | null> => {
    if (!part) return null;
    setBusy(true);
    setRefusal(null);
    setStatus(`Building the ${FORMATS.find((f) => f.value === format)?.label ?? format} bundle…`);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part,
          format,
          ...(vendorCad
            ? { importedCad: { fileName: vendorCad.name, source: await vendorCad.text(), ...(vendorCadPinEvidence ? { pinEvidence: vendorCadPinEvidence } : {}) } }
            : {}),
          ...(vendorStep ? { importedStep: { fileName: vendorStep.name, source: await vendorStep.text() } } : {}),
          // The package the user is HOLDING. This is what makes `/api/export`
          // apply `asPackage`, which is the only place the relabelling rule is.
          ...(needsPackage && chosenPackage ? { packageType: chosenPackage } : {}),
          // THE MORE SPECIFIC ANSWER WINS, and the order is the whole rule.
          // Install-scoped answers first, so a remembered value is still sent on
          // an export nobody answered anything for this time; then the answers
          // given for THIS part, which override them. Reversed, a package whose
          // body is wider than the install-wide seated span is asked for a span
          // FOR THAT PACKAGE, the user types it, and the install value overwrites
          // it with the very number that could not work. The screen then asks
          // again, in the same words, forever.
          ...answersFromSettings(settings),
          ...answers,
          settings,
          assurance: {
            evaluated: true,
            findings: cadPendingFindings(
              review,
              packageChoice?.ok
                ? (packageChoice.options.find((option) => option.designator === (chosenPackage ?? part.packageType.value))
                    ?.confirmation?.items ?? toCheck)
                : toCheck
            )
          }
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        const code = payload?.code;
        // EACH REFUSAL NAMES ITS FIELDS. A value the user can supply is a
        // different thing from one the datasheet never stated, and both are
        // different from a name this format cannot encode.
        if (code === "INPUT_REQUIRED" && Array.isArray(payload?.needs) && payload.needs.length > 0) {
          // ANSWERABLE, not merely named. This set a list of LABELS and put
          // nothing on the screen to answer them with, so the one refusal the
          // product can actually resolve was a dead end: the user was told which
          // number was missing and given no box to type it into.
          const needs = payload.needs as RequiredInput[];
          setPendingNeeds(needs);
          setRefusal(null);
          // THE ROUTE'S OWN SENTENCE, not a count of its questions.
          //
          // `askForLandPattern` distinguishes three cases and says which: a
          // check rejected what the document printed, or the pattern was read
          // and the ARRANGEMENT was not, or the document genuinely did not say.
          // Replacing all three with "3 values are needed" throws away the one
          // thing that tells a user whether to look at the page again or reach
          // for an application note. Measured on RHF1201, where the same three
          // questions come back until all three are in hand and the count alone
          // says nothing about why.
          setStatus(
            typeof payload.error === "string" && payload.error.trim() !== ""
              ? payload.error
              : needs.length === 1
                ? "One value is needed to build the footprint."
                : `${needs.length} values are needed to build the footprint.`
          );
          return null;
        }
        if (code === "UNTRACEABLE_EXTRACTION" && Array.isArray(payload?.untraceable)) {
          setRefusal({ kind: "untraceable", fields: payload.untraceable as string[] });
          setStatus("");
          return null;
        }
        if (code === "INCOMPLETE_EXTRACTION" && Array.isArray(payload?.missing)) {
          setRefusal({ kind: "missing", fields: payload.missing as string[] });
          setStatus("");
          return null;
        }
        if (code === "FORMAT_CANNOT_ENCODE") {
          const alternative = (payload?.availableFormats as string[] | undefined)?.[0];
          setStatus(
            alternative
              ? `${payload?.error} Try ${alternative.toUpperCase()}, which has no such limit.`
              : String(payload?.error ?? "That format cannot encode this name.")
          );
          return null;
        }
        throw new Error(String(payload?.error ?? "The export failed."));
      }

      const blob = await response.blob();
      if (download) {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `${part.partNumber.value || "forge-part"}-forge.zip`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      }
      // WHAT THE SERVER SAID ABOUT WHAT IT BUILT, not our guess at it. The note
      // carries things like a package having been relabelled.
      const said = decodeURIComponent(response.headers.get("X-Forge-Export-Note") || "");
      setStatus(download ? (said || "Downloaded.") : "CAD bundle built. Building the SPICE model…");
      return blob;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The export failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [part, format, needsPackage, chosenPackage, settings, supplied, review, toCheck, packageChoice, vendorCad, vendorCadPinEvidence, vendorStep]);

  /**
   * Answers one outstanding question and retries the export immediately.
   *
   * The freshly typed answer is passed alongside the remembered ones, because a
   * React state update is not visible to the handler that queued it.
   */
  const handleSupplyNeed = useCallback(
    async (need: RequiredInput, raw: string) => {
      const judged = answerFor(need, raw);
      if (!judged.ok) {
        setStatus(judged.message);
        return;
      }
      // Remembered UNDER ITS OWN FIELD NAME. A single-value version stored any
      // install answer as the lead span, so answering the foot overwrote the
      // span and the next flat pack was built from the wrong number.
      if (need.scope === "install" && typeof judged.value === "number") {
        rememberInstallAnswer(need.field, judged.value);
        setSettings((current) => ({ ...current, [need.field]: judged.value as number }));
      }
      const answers = { ...supplied, [need.field]: judged.value };
      setSupplied(answers);
      // THE ANSWER STAYS IN THE BOX.
      //
      // A land pattern is asked for as a GROUP - length, width and span - and
      // the export re-asks the whole group until every one of them is in hand.
      // Clearing the box meant the question came back looking exactly as it had
      // before it was answered: same three fields, same empty inputs, no sign
      // the number had been taken. Measured on RHF1201, which asks for all
      // three. Leaving the value shows which of the group are done.
      // Cleared optimistically. The retry repopulates it with whatever is STILL
      // missing, so a part needing three numbers walks down to none.
      setPendingNeeds([]);
      await takeTheBundle(answers);
    },
    [supplied, takeTheBundle]
  );

  const reset = useCallback(() => {
    setPhase("empty");
    setRefusal(null);
    setFile(null);
    setPrompt("");
    setIdentified(null);
    setPart(null);
    setToCheck([]);
    setPackageChoice(null);
    setGeometry(null);
    setChosenPackage(null);
    // The model belongs to the datasheet that was read. Left behind, the next
    // part's screen would show the previous part's conformance rows and hand
    // over the previous part's zip: the "null is not a default" shape, where a
    // stale value and an unread one are the same state.
    setSpice(null);
    setSpiceAsks([]);
    setSpiceCorrectionNeeds([]);
    setSpiceCorrections([]);
    setSpiceCorrectionOptions([]);
    setSpiceBlockChoices([]);
    setSpiceBlockChoice("");
    setSpiceReviewDeviceClass("");
    setSpiceRefusalPages([]);
    setSpiceRefusalBlock(null);
    setEditingSpice(null);
    setCorrectionDraft(null);
    setVendorModel(null);
    setVendorCandidates([]);
    setVendorCandidate("");
    setVendorInstanceParameter(null);
    setVendorInstanceValue("");
    setSpiceVendorResource(null);
    setVendorUploadAccepted(false);
    setSpiceDirty(false);
    setVendorCad(null);
    setVendorCadPinEvidence(null);
    setVendorStep(null);
    setOfficialResources([]);
    setOfficialImportChoices([]);
    setDiscoveringOfficial(false);
    setImportingOfficial(false);
    attemptedOfficialImports.current.clear();
    officialResourceIdentity.current = "";
    setReview([]);
    setChecks([]);
    setPageImages([]);
    setDrawingPage(null);
    setPendingNeeds([]);
    setNeedValues({});
    setSupplied({});
    setStatus("");
    if (fileInput.current) fileInput.current.value = "";
  }, []);

  /**
   * The stages and where the bar sits, recomputed from the clock every tick.
   *
   * DERIVED, never stored. The old version kept a `stages` array in state, wrote
   * to it nowhere and rendered stage three as active forever: the state and the
   * screen could not disagree, because the screen was not reading the state. A
   * value computed from `elapsedMs` cannot go stale that way.
   */
  //
  // `retrieving` is the LOOKUP path: no file chosen, so the route has to go and
  // find the datasheet before it can read anything. That is a real stage of the
  // request, worth up to 45 seconds, and the bar described the model pipeline
  // only until 2026-09-04 - so a lookup showed "whole document to the model"
  // during a fetch that had no document yet.
  // Ticks only while a search is in flight, and the interval is torn down with
  // it, so an idle screen holds no timer.
  useEffect(() => {
    if (!searching) {
      setSearchElapsedMs(0);
      return;
    }
    setSearchElapsedMs(0);
    const id = window.setInterval(() => setSearchElapsedMs(Date.now() - searching.since), 500);
    return () => window.clearInterval(id);
  }, [searching]);

  // What the status row actually prints. A live search outranks whatever the
  // last one left behind, so a retry never shows the previous failure's text
  // while it is running.
  const statusLine = searching ? searchLine(searchElapsedMs, searching.part) : status;

  const stages = useMemo(() => stagesFor(intent, { retrieving: !file }), [intent, file]);
  const progress = useMemo(
    () => progressAt(elapsedMs, stages, phase === "done"),
    [elapsedMs, stages, phase]
  );
  const seconds = Math.round(elapsedMs / 1000);

  /**
   * WHAT IS BEING WORKED ON, IN THE ONE LINE THAT PERSISTS.
   *
   * This carries the identification as well as the name, so the free pass has
   * somewhere to report without a five-row table under it saying the same
   * things again. The part number leads because it is what an engineer is
   * holding; the file name is the fallback when nothing could be identified.
   */
  const composer = useMemo(() => {
    const name = identified?.partNumber || file?.name || prompt.trim();
    // WHAT WAS ACTUALLY IDENTIFIED, AND WHAT WAS NOT.
    //
    // The part number in the free pass is the FILE NAME - `buildPartRecord`
    // marks it `user` because nobody read it - and printing it as the heading
    // of an identification presents an assumption as a fact. So the line says
    // which it is. The document's own name for itself comes out of the read.
    const facts = identified
      ? [
          identified.manufacturer,
          identified.partNumberFrom === "file-name" ? "named from the file" : null,
          `${identified.pageCount} pages`
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    if (phase === "reading") return { text: name, sub: [facts, `reading ${clock(seconds)}`].filter(Boolean).join(" · ") };
    if (phase === "done") return { text: name, sub: [facts, `read in ${clock(seconds)}`].filter(Boolean).join(" · ") };
    return { text: name, sub: facts };
  }, [phase, identified, file, prompt, seconds]);

  const showCad = intent !== "spice";
  const showSpice = intent !== "cad";

  /**
   * WHAT THE SCREEN SAYS AFTER A READ, and everything it is derived from.
   *
   * Every one of these is computed by a function in `src/lib`, shared with `/`.
   * A second implementation here would be a second verdict, and two screens with
   * two verdicts is two products whose divergence is invisible: each looks
   * self-consistent.
   */
  const activePackage = chosenPackage ?? part?.packageType.value ?? null;
  const packageOutcomes = useMemo(() => packageOutcomesOf(packageChoice), [packageChoice]);
  const nothingBuildable = useMemo(() => nothingBuildableIn(packageOutcomes), [packageOutcomes]);
  const choosable = useMemo(
    () => choosableFrom(packageChoice, part?.packageVariants ?? []),
    [packageChoice, part]
  );
  const knownNeeds = useMemo(() => knownNeedsFor(packageChoice, activePackage), [packageChoice, activePackage]);
  /** What the export ASKED outranks what we guessed it would ask. */
  const shownNeeds = pendingNeeds.length > 0 ? pendingNeeds : knownNeeds;
  const blockingReview = useMemo(() => review.filter((item) => item.blocking), [review]);
  const activeConfirmation = useMemo(
    () =>
      packageChoice?.ok
        ? packageChoice.options.find((option) => option.designator === activePackage)?.confirmation?.items ?? toCheck
        : toCheck,
    [packageChoice, activePackage, toCheck]
  );
  const pendingAssurance = useMemo(
    () => cadPendingFindings(review, activeConfirmation),
    [review, activeConfirmation]
  );
  const shown = useMemo(() => (part ? shownRecord(part, activePackage) : null), [part, activePackage]);
  const cadLimitations = useMemo(
    () => cadElectricalTypeLimitations(shown?.pins ?? []),
    [shown]
  );
  const verdict = useMemo(
    () =>
      part
        ? readVerdict({
            part,
            packageChoice,
            chosenPackage,
            choosable,
            needs: shownNeeds,
            blockingReview: blockingReview.length,
            toCheck: pendingAssurance.length,
            outcomes: packageOutcomes,
            nothingBuildable
          })
        : null,
    [part, packageChoice, chosenPackage, choosable, shownNeeds, blockingReview.length, pendingAssurance.length, packageOutcomes, nothingBuildable]
  );
  const imageFor = useCallback(
    (page: number | null | undefined) => (page ? pageImages.find((image) => image.page === page) : undefined),
    [pageImages]
  );

  /** "I looked at the page and this is right." The citation is kept. */
  const handleConfirmReview = useCallback((item: ReviewItem) => {
    setPart((record) => (record ? withField(record, item.field, { confidence: 1, method: "user-confirmed" }) : record));
    setReview((items) => items.filter((entry) => entry.field !== item.field));
    setStatus(`Confirmed ${item.label.toLowerCase()} against page ${item.page ?? "?"}.`);
  }, []);

  /**
   * "I looked at the page and it says something else."
   *
   * `userEdited` rather than a patch of value/confidence/method: `withField`
   * MERGES, so a patch that does not mention the citation keeps the model's, and
   * the corrected number then cites the page the wrong number came from.
   */
  const handleCorrectReview = useCallback((item: ReviewItem, raw: string) => {
    const judged = correctionFor(item.field, item.label, raw);
    if (!judged.ok) {
      setStatus(judged.message);
      return;
    }
    setPart((record) => (record ? withField(record, item.field, userEdited(judged.value)) : record));
    setReview((items) => items.filter((entry) => entry.field !== item.field));
    setStatus(`Set ${item.label.toLowerCase()} to ${raw.trim()}.`);
  }, []);

  const beginSpiceCorrection = useCallback((parameter: SpiceResult["parameters"][number]) => {
    setEditingSpice(parameter.key);
    setCorrectionDraft({
      min: parameter.printed.min === null ? "" : String(parameter.printed.min),
      typ: parameter.printed.typ === null ? "" : String(parameter.printed.typ),
      max: parameter.printed.max === null ? "" : String(parameter.printed.max),
      unit: parameter.unit,
      page: parameter.page === null ? "" : String(parameter.page)
    });
    setStatus("");
  }, []);

  const saveSpiceCorrection = useCallback(async (parameter: { key: string }) => {
    if (!correctionDraft) return;
    const numberOrNull = (raw: string) => raw.trim() === "" ? null : Number(raw);
    const printed = {
      min: numberOrNull(correctionDraft.min),
      typ: numberOrNull(correctionDraft.typ),
      max: numberOrNull(correctionDraft.max)
    };
    const page = Number(correctionDraft.page);
    if (!Number.isInteger(page) || page < 1 || !correctionDraft.unit.trim() || Object.values(printed).every((value) => value === null)) {
      setStatus("A reviewed value needs at least one number, its printed unit, and a source page.");
      return;
    }
    if (Object.values(printed).some((value) => value !== null && !Number.isFinite(value))) {
      setStatus("Every corrected corner must be a number.");
      return;
    }
    const correction: SpiceCorrection = {
      parameter: parameter.key,
      printed,
      unit: correctionDraft.unit.trim(),
      page,
      scope: spice?.block.scope ?? spiceRefusalBlock?.scope ?? null,
      group: spice?.block.group ?? spiceRefusalBlock?.group ?? null
    };
    const next = [...spiceCorrections.filter((item) => item.parameter !== parameter.key), correction];
    setSpiceCorrections(next);
    setEditingSpice(null);
    setCorrectionDraft(null);
    setSpiceDirty(true);
    await takeTheModel(null, false, next);
  }, [correctionDraft, spice, spiceCorrections, spiceRefusalBlock, takeTheModel]);

  return (
    <div className={`suite suite-${phase}`}>
      <header className="suite-bar">
        {/* The one wordmark. */}
        <span className="wordmark">Forge</span>
        {/* WHO IS SIGNED IN, BESIDE THE GEAR THAT CHANGES IT. A settings icon
            with nothing next to it makes the user open the panel to find out
            whether the first run ever completed. */}
        {ready && account && <span className="suite-who">{account.organisation ?? account.name}</span>}
        <button
          type="button"
          className="gear"
          onClick={() => setSettingsOpen(true)}
          aria-label="Account and assembly line settings"
          title="Account and assembly line settings"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.4H9l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 2.6h6l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>

      {/* THE FIRST RUN OPENS ITSELF, and only until an account exists. It is
          rendered after `ready` so a returning user never sees it flash: before
          the mount effect, "no account" and "not looked yet" are the same value. */}
      {firstRunOpen && (
        <Onboarding
          settings={settings}
          onSaveSettings={changeSettings}
          onCreateAccount={createAccount}
          onDismiss={() => setFirstRunDismissed(true)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          account={account}
          settings={settings}
          onAccount={setAccount}
          onSettings={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <main className="suite-main">
        {phase === "empty" && (
          <div className="suite-hero">
            <h1>Drop a datasheet, or name a part.</h1>
          </div>
        )}

        {/* THE FRAME. One element for the whole session: it settles to the top
            after the first submit and everything below is its body. */}
        <section className="frame">
          <span className={`frame-top frame-top-${phase}`} aria-hidden="true" />

          <div className="frame-composer">
            {phase === "empty" ? (
              <input
                className="frame-input"
                value={prompt}
                // The heading above says where a PDF goes, so the placeholder
                // does not repeat it word for word one line apart. It carries an
                // example instead, marked AS an example: a bare part number
                // reads as a value already filled in, or as a string that must
                // be matched. The part number is the example worth showing
                // because identification wants the full MPN with its suffix,
                // not "op amp".
                placeholder="e.g. LMP7704-SP"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && prompt.trim()) void identifyPrompt();
                }}
              />
            ) : (
              <span className="frame-held">
                <span className="frame-name">{composer.text}</span>
                <span className="frame-sub">{composer.sub}</span>
              </span>
            )}
            {phase !== "empty" && (
              <button type="button" className="btn btn-quiet" onClick={reset} disabled={busy}>
                Start another part
              </button>
            )}
          </div>

          <div className="frame-intents">
            {INTENTS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`chip${intent === option.key ? " chip-on" : ""}`}
                // Locked once the read has been spent: it is what aimed the read,
                // so changing it here would describe a read that did not happen.
                disabled={phase === "reading" || phase === "done"}
                // The stages follow the intent by derivation, not by a second
                // setter kept in step by hand.
                onClick={() => setIntent(option.key)}
              >
                {option.label}
              </button>
            ))}
            <span className="frame-actions">
              {/* SHOWN IN EVERY PHASE, INCLUDING `empty`, because that is the one
                  where the wait happens with nothing else on screen. Both
                  identify paths set this to "Finding X…" before they start, and
                  gating it to `phase !== "empty"` meant a lookup ran for as long
                  as the network took behind a screen that had not visibly
                  changed: the click looked like it had missed, and the honest
                  response was to press it again. `status` is "" until something
                  sets it, so the first paint is unaffected. */}
              {statusLine && <span className="frame-status">{statusLine}</span>}
              {phase === "empty" && (
                <>
                  <input
                    ref={fileInput}
                    id="suite-file"
                    type="file"
                    accept="application/pdf"
                    className="visually-hidden"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0] ?? null;
                      event.target.value = "";
                      onPick(chosen);
                    }}
                  />
                  <label className="btn" htmlFor="suite-file">
                    Choose a PDF
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !prompt.trim()}
                    onClick={() => void identifyPrompt()}
                  >
                    {intent === "cad" ? "Read for CAD" : intent === "spice" ? "Read for SPICE" : "Read for both"}
                  </button>
                </>
              )}
            </span>
          </div>

          {phase === "identified" && (
            <div className="frame-body">
              {/* THE IDENTIFICATION IS IN THE COMPOSER LINE, not in a table
                  under it. Part, manufacturer and page count were printed twice
                  on this screen, two inches apart, and the two remaining rows
                  were a count of the list directly below and eight characters
                  of a hash nothing on the screen used. */}
              {/* NOTHING WAS IDENTIFIED, so there is no package list to show and
                  no datasheet to read. Rendering the chooser here printed an
                  empty "Package" heading, which reads as "identified, and it has
                  no packages" rather than "never identified". Reported
                  2026-09-10 against a rad-hard part: the screen looked like the
                  lookup had failed and the button next to it still said it would
                  read a datasheet. */}
              {!identified && !file ? (
                <div className="frame-recover">
                  {/* SHORT, because the status line directly above already names
                      the part and says it was not found. This says only what to
                      do about it. */}
                  <p className="frame-note">No datasheet found. Retry below, or upload the PDF.</p>
                  {/* THE UPLOAD HATCH BELONGS HERE, not only on the empty screen.
                      Retrieval not finding a public PDF is the normal case for
                      controlled and military parts, and until 2026-09-10 the only
                      datasheet picker lived in the `empty` phase: the way out of a
                      failed lookup was "Start another part", which throws away
                      what the user typed. `identifyPrompt` claimed to keep this
                      hatch open and did not. */}
                  <label className="btn" htmlFor="suite-file-direct">
                    Upload the datasheet PDF instead
                  </label>
                  <input
                    id="suite-file-direct"
                    type="file"
                    accept="application/pdf"
                    className="visually-hidden"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0] ?? null;
                      event.target.value = "";
                      onPick(chosen);
                    }}
                  />
                </div>
              ) : needsPackage && (identified?.packages.length ?? 0) === 0 ? (
                // IDENTIFIED, BUT THE DOCUMENT NAMED NO PACKAGE.
                //
                // The chooser rendered its heading over an empty list, which
                // reads as a chooser still loading rather than as "there is
                // nothing here to choose". Seen 2026-09-10 alongside the
                // `NOTAPART` retrieval, and it outlives that: a real datasheet
                // with no ordering table reaches this state honestly, and the
                // read can still find the package on the drawing.
                <p className="frame-note">
                  No ordering table in this document, so there is no package to choose. The read will
                  take the package from the drawing.
                </p>
              ) : needsPackage ? (
                <div className="pick-package">
                  <h2 className="frame-label">Package</h2>
                  <ul className="packages">
                    {(identified?.packages ?? []).map((variant) => (
                      <li key={variant.designator}>
                        <button
                          type="button"
                          className={`pkg${chosenPackage === variant.designator ? " pkg-active" : ""}`}
                          onClick={() => setChosenPackage(variant.designator)}
                        >
                          <span className="pkg-name">{variant.designator}</span>
                          <span className="pkg-meta">
                            {variant.family}
                            {variant.leadCount ? ` · ${variant.leadCount} leads` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                // Said once, because the absence of a chooser is otherwise
                // unexplained. The rest of the reasoning is in this file's
                // header comment.
                <p className="frame-note">No package to choose: a macromodel describes the die.</p>
              )}

              <div className="frame-go">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={busy || discoveringOfficial || importingOfficial || automaticImportsWaiting.length > 0 || (needsPackage && (identified?.packages.length ?? 0) > 0 && !chosenPackage)}
                  // RETRYING A SEARCH IS NOT A READ, so it does not open the
                  // reading screen. That screen shows a four-stage progress list
                  // and a driven bar, which together assert that a document is in
                  // hand and being parsed. Sending a retry through `runRead`
                  // showed all of it while retrieval was still looking, and showed
                  // it again on the way back out when nothing was found.
                  //
                  // `identifyPrompt` is the same free retrieval the first attempt
                  // made. It ends in one of two honest places: this panel again,
                  // or an identified part with its packages, from which the read
                  // is then started deliberately.
                  onClick={() => void (!identified && !file ? identifyPrompt() : runRead())}
                >
                  {/* The CAD label gets MORE specific once a package is
                      chosen. The SPICE one got less: "Read for SPICE" before a
                      file was chosen became "Read for the model" after it. */}
                  {/* "Read this datasheet" is a claim, and after a failed
                      identification it is a false one: the read has to FIND a
                      document before it can read anything, which is the first
                      stage the progress list already names. */}
                  {!identified && !file
                    ? "Retry the search"
                    : needsPackage
                      ? (chosenPackage ? `Read for ${chosenPackage}` : "Read this datasheet")
                      : "Read for the SPICE model"}
                </button>
                <span className="frame-note">
                  {discoveringOfficial || importingOfficial
                    ? "Checking official manufacturer artifacts before the read…"
                    : // The read's cost and target, which a retry has neither of:
                      // it searches, and stops. Printing "About 90 seconds" beside
                      // it described work that does not start until a document is
                      // found.
                      !identified && !file
                      ? ""
                      : intentNote(intent)}
                </span>
              </div>
            </div>
          )}

          {phase === "reading" && (
            <div className="frame-body">
              {/* THE FILL IS DRIVEN, NOT DECORATIVE. Width comes from the clock
                  and a linear transition of one tick carries it between samples,
                  so it always reads as moving. It stops short of full and creeps:
                  only the response landing fills it. */}
              <div
                className="heat"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={progress.index + 1}
                aria-valuetext={`Stage ${progress.index + 1} of 4, ${stages[progress.index]?.name ?? ""}`}
              >
                <span className="heat-fill" style={{ width: `${(progress.fraction * 100).toFixed(2)}%` }}>
                  <span className="heat-sweep" />
                </span>
              </div>
              {/* FOUR NAMES AND FOUR CLOCKS. Each row also carried a sentence
                  explaining itself, so a screen whose whole job is "wait" held
                  four stage names, four timestamps, four explanations and a
                  four-line paragraph. The explanations are on the rows as
                  `title`, where they are there for whoever wants them and are
                  not read by everybody every run. */}
              <ol className="stages">
                {stages.map((stage, index) => {
                  const state = index < progress.index ? "stage-done" : index === progress.index ? "stage-on" : "stage-todo";
                  const startedAt = progress.startedAt[index];
                  return (
                    <li key={stage.name} className={`stage ${state}`} title={stage.note}>
                      <span className="stage-dot" aria-hidden="true" />
                      <span className="stage-name">{stage.name}</span>
                      <span className="stage-at">{startedAt === null ? "" : clock(startedAt)}</span>
                    </li>
                  );
                })}
              </ol>
              {/* NO PARAGRAPH UNDER THE BAR. Anthony's call, 2026-09-02: it
                  said the read takes about ninety seconds and that the bar is an
                  estimate, and neither is worth a line of prose on every run.
                  The elapsed clock is in the composer at the top of the frame,
                  which is the one place this screen keeps one. */}
            </div>
          )}

          {/* A SPICE RUN HAS NO `part`, and requiring one rendered NOTHING.
              The record comes from the CAD parse, which a model does not need
              and no longer runs, so this gate would have shown a finished read
              as a blank screen with no error anywhere. */}
          {phase === "done" && (part || spice || refusal) && (
            <div className="frame-body frame-done">
              {/* The verdict, review, confirmation and refusal panels below use
                  the shared library components and rules also used by `/`. */}
              {/* NOT OFFERED WHEN IT CANNOT SUCCEED. `packageChoice.ok === false`
                  means the reading is short of something no choice on this screen
                  can supply, so the button below could only produce a refusal.
                  Same rule the existing workspace applies to `Build library`.

                  Said ONCE, beside the disabled button further down. It used to
                  be said here as well, in different words, on the same screen. */}
              {/* THE ANSWER, first. The same component `/` renders, reaching the
                  same verdict through `src/lib/verdict.ts`. This shell showed a
                  footprint preview and an export button with nothing above them
                  saying whether the record could be built at all. */}
              {verdict && shown && part && (
                <VerdictCard
                  part={part}
                  shown={shown}
                  pins={shown.pins}
                  verdict={verdict}
                  // DRAWN ONCE, and not here. `VerdictCard` renders the
                  // geometry itself when given it, which on `/` is the only
                  // place it appears. This screen has its own Footprint section
                  // with the drawing, its heading and the controls that act on
                  // it, so passing it here put the same picture on screen twice.
                  // Reported 2026-09-10 against LTC6563. `/` is unaffected: it
                  // still passes its geometry and still draws it under the
                  // verdict.
                  previewGeometry={null}
                  activePackage={activePackage}
                  sourceUrl={evidenceUrl(part.sourceUrl ?? identified?.sourceUrl)}
                  checks={checks}
                  failedChecks={checks.filter((check) => check.state === "fail")}
                  openChecks={checks.filter((check) => check.state !== "pass")}
                  busy={busy}
                  onRetry={verdict.action === "re-read" && file ? () => void runRead() : undefined}
                />
              )}

              <div className="outputs">
                {showCad && (
                  <div className="output">
                    <h3>Footprint</h3>
                    {geometry ? (
                      <FootprintPreview geometry={geometry} source={geometry.provenance.source} />
                    ) : (
                      <p className="frame-note">No geometry was produced for {chosenPackage ?? "this package"}.</p>
                    )}
                    {/* THE MANUFACTURER'S OWN FILES, FOLDED.
                        Not decoration and not dead: this is the vendor-artifact
                        leg of RULES.md's recovery order, where an official
                        footprint or STEP is evidence Forge validates and emits
                        instead of its own geometry. It is also the exception
                        rather than the run, and open it was two buttons, two
                        filenames and two paragraphs of explanation standing
                        permanently under a footprint that was usually fine. */}
                    <details className="reviews-fold vendor-fold">
                      <summary>Use the manufacturer's own footprint or 3D model</summary>
                    <div className="vendor-model-controls cad-import-controls">
                      <label className="btn" htmlFor="vendor-cad-file">Use vendor footprint</label>
                      <input
                        id="vendor-cad-file"
                        className="visually-hidden"
                        type="file"
                        accept=".kicad_mod,.lbr"
                        onChange={(event) => {
                          const chosen = event.target.files?.[0] ?? null;
                          setVendorCad(chosen);
                          setVendorCadPinEvidence(null);
                          setOfficialImportChoices((choices) => choices.filter((choice) => choice.kind !== "cad"));
                          setStatus(chosen ? `${chosen.name} will replace generated copper after Forge validates its pins and geometry.` : "");
                        }}
                      />
                      <span className="vendor-file">{vendorCad?.name ?? "No vendor footprint selected"}</span>
                    </div>
                    <p className="frame-note">Optional. Forge imports vendor copper into its neutral geometry, checks it against this part, and emits it in your selected format.</p>
                    <div className="vendor-model-controls cad-import-controls">
                      <label className="btn" htmlFor="vendor-step-file">Use vendor 3D model</label>
                      <input
                        id="vendor-step-file"
                        className="visually-hidden"
                        type="file"
                        accept=".step,.stp"
                        onChange={(event) => {
                          const chosen = event.target.files?.[0] ?? null;
                          setVendorStep(chosen);
                          setOfficialImportChoices((choices) => choices.filter((choice) => choice.kind !== "step"));
                          setStatus(chosen ? `${chosen.name} will replace the generated 3D body after Forge validates the STEP file.` : "");
                        }}
                      />
                      <span className="vendor-file">{vendorStep?.name ?? "No vendor 3D model selected"}</span>
                    </div>
                    <p className="frame-note">Optional. Forge preserves a complete manufacturer STEP model and links or embeds it in the selected CAD format.</p>
                    </details>
                    {officialResources.some((resource) => resource.kind === "cad" || resource.kind === "step" || resource.kind === "package-drawing") && (
                      <ul className="resource-links" aria-label="Official CAD resources found automatically">
                        {officialResources.filter((resource) => resource.kind === "cad" || resource.kind === "step" || resource.kind === "package-drawing").map((resource) => (
                          <li key={resource.url}>
                            <a href={resource.url} target="_blank" rel="noreferrer">{resource.label}</a>
                            {(resource.kind === "cad" || resource.kind === "step") && <button type="button" className="btn btn-quiet" disabled={busy || importingOfficial} onClick={() => void useOfficialResource(resource)}>Import</button>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {officialImportChoices.find((choice) => choice.kind === "cad") && (() => {
                      const officialImportChoice = officialImportChoices.find((choice) => choice.kind === "cad")!;
                      return (
                      <div className="resource-choice" role="group" aria-labelledby="cad-resource-choice-heading">
                        <p id="cad-resource-choice-heading">
                          <strong>Choose the manufacturer footprint for your selected package.</strong>{" "}
                          Forge found these inside {officialImportChoice.label}; it will validate the selected copper before export.
                        </p>
                        <ul className="resource-links">
                          {officialImportChoice.files.map((candidate) => (
                            <li key={candidate.fileName}>
                              <span className="vendor-file" title={candidate.fileName}>{candidate.fileName}</span>
                              <button type="button" className="btn btn-quiet" onClick={() => selectOfficialFile("cad", candidate, officialImportChoice.pinEvidence)}>Use this footprint</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                      );
                    })()}
                    {officialImportChoices.find((choice) => choice.kind === "step") && (() => {
                      const officialImportChoice = officialImportChoices.find((choice) => choice.kind === "step")!;
                      return (
                        <div className="resource-choice" role="group" aria-labelledby="step-resource-choice-heading">
                          <p id="step-resource-choice-heading"><strong>Choose the manufacturer 3D model for your selected package.</strong></p>
                          <ul className="resource-links">
                            {officialImportChoice.files.map((candidate) => (
                              <li key={candidate.fileName}>
                                <span className="vendor-file" title={candidate.fileName}>{candidate.fileName}</span>
                                <button type="button" className="btn btn-quiet" onClick={() => selectOfficialFile("step", candidate)}>Use this 3D model</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {showSpice && (
                  <div className="output">
                    <h3>SPICE model</h3>
                    {/* WHAT THE MODEL DOES AGAINST WHAT THE DATASHEET SAYS.
                        This panel said "Netlist panel goes here" while the
                        route, the reader, the emitter and the verifier all
                        existed: the receipt was inside a zip and a person
                        learned what had been checked only by unzipping it.
                        Same rows as the conformance report in the bundle, from
                        the same response, so the screen and the file cannot
                        disagree. */}
                    {spice ? (
                      <>
                        {/* WHAT KIND OF PART, first. A class chosen wrongly
                            produces a model that simulates cleanly and
                            describes a different device, and no check below
                            can catch it: they verify against the numbers the
                            class chose. The person holding the datasheet is
                            the only one who can. */}
                        <p className="frame-note">
                          Built as a <strong>{spice.deviceClassLabel ?? "model"}</strong>, from what this datasheet
                          states{spice.deviceClassChosenBy === "the-caller-reviewed" ? " and the device kind you selected during page review" : ""} rather than from the part number.
                        </p>
                        <p className="frame-note">
                          {spice.parameters.length} parameters
                          {spice.block.scope ? ` under ${spice.block.scope}` : ""}
                          {spice.block.group ? `, grade ${spice.block.group}` : ""}.
                        </p>
                        {/* A CHECK AGAINST A NUMBER THE USER TYPED IS NOT A
                            CHECK, and this sits above the table that looks like
                            one. */}
                        {spice.suppliedByUser.length > 0 && (
                          <p className="frame-note frame-warn">
                            {spice.suppliedByUser.join(", ")} {spice.suppliedByUser.length === 1 ? "was" : "were"} supplied
                            by you, not read: this datasheet does not state it. Rows below for that parameter check the
                            generator against your own number and say nothing about the part.
                          </p>
                        )}
                        <details className="spice-review" data-testid="spice-parameter-review">
                          <summary>Review {spice.parameters.length} extracted parameters</summary>
                          <p className="frame-note">
                            Change a value only after comparing it with the cited page. Forge rebuilds the model and records your correction in the receipt.
                          </p>
                          <div className="spice-parameters" role="list">
                            {spice.parameters.map((parameter) => {
                              const editing = editingSpice === parameter.key && correctionDraft;
                              const sourcePage = parameter.page === null
                                ? undefined
                                : spice.reviewPages.find((page) => page.page === parameter.page);
                              return (
                                <div className={`spice-parameter${parameter.correctedByUser ? " spice-parameter-corrected" : ""}`} role="listitem" key={parameter.key}>
                                  <div className="spice-parameter-head">
                                    <span>
                                      <strong>{parameter.key}</strong>
                                      <span className="spice-source">
                                        {parameter.correctedByUser ? "corrected by you" : parameter.page === null ? "supplied by you" : `page ${parameter.page}`}
                                      </span>
                                    </span>
                                    {!editing && parameter.page !== null && (
                                      <button type="button" className="btn btn-quiet" onClick={() => beginSpiceCorrection(parameter)}>
                                        Review or correct
                                      </button>
                                    )}
                                  </div>
                                  {!editing ? (
                                    <dl className="spice-corners">
                                      {(["min", "typ", "max"] as const).map((corner) => (
                                        <div key={corner}>
                                          <dt>{corner}</dt>
                                          <dd>{parameter.printed[corner] ?? "—"}</dd>
                                        </div>
                                      ))}
                                      <div><dt>unit</dt><dd>{parameter.unit}</dd></div>
                                    </dl>
                                  ) : (
                                    <div className="spice-correction">
                                      {sourcePage && (
                                        <figure className="spice-page">
                                          {/* The rendered page is the evidence used for review; never the flattened text layer. */}
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={`data:${sourcePage.mimeType};base64,${sourcePage.base64}`} alt={`Datasheet page ${sourcePage.page}, source for ${parameter.key}`} />
                                          <figcaption>Datasheet page {sourcePage.page}</figcaption>
                                        </figure>
                                      )}
                                      <div className="spice-correction-fields">
                                        {(["min", "typ", "max"] as const).map((corner) => (
                                          <label key={corner}>
                                            <span>{corner}</span>
                                            <input
                                              type="number"
                                              step="any"
                                              value={correctionDraft[corner]}
                                              onChange={(event) => setCorrectionDraft({ ...correctionDraft, [corner]: event.target.value })}
                                            />
                                          </label>
                                        ))}
                                        <label>
                                          <span>Printed unit</span>
                                          <input value={correctionDraft.unit} onChange={(event) => setCorrectionDraft({ ...correctionDraft, unit: event.target.value })} />
                                        </label>
                                        <label>
                                          <span>Source page</span>
                                          <input type="number" min="1" step="1" value={correctionDraft.page} onChange={(event) => setCorrectionDraft({ ...correctionDraft, page: event.target.value })} />
                                        </label>
                                        <div className="spice-correction-actions">
                                          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveSpiceCorrection(parameter)}>
                                            Rebuild with correction
                                          </button>
                                          <button type="button" className="btn" disabled={busy} onClick={() => { setEditingSpice(null); setCorrectionDraft(null); }}>
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                        {spice.asy && <SpiceSymbolPreview source={spice.asy} partNumber={spice.partNumber} />}
                        <section className="vendor-model" aria-labelledby="vendor-model-heading">
                          <div className="vendor-model-head">
                            <div>
                              <h4 id="vendor-model-heading">Vendor model cross-check</h4>
                              <p className="frame-note">Optional. Forge tests the vendor file you supply and never puts it in your download.</p>
                            </div>
                            {spice.vendorResource && (
                              <a href={spice.vendorResource.url} target="_blank" rel="noreferrer">
                                {spice.vendorResource.modelKnown ? "Get the known vendor model" : "Check vendor product resources"}
                              </a>
                            )}
                          </div>
                          <div className="vendor-model-controls">
                            <label className="btn" htmlFor="vendor-spice-file">Choose vendor model</label>
                            <input
                              id="vendor-spice-file"
                              className="visually-hidden"
                              type="file"
                              accept=".lib,.cir,.sub,.mod,.ckt,.sp,.spi,.inc,.txt,text/plain"
                              onChange={(event) => {
                                const chosen = event.target.files?.[0] ?? null;
                                setVendorModel(chosen);
                                setVendorCandidates([]);
                                setVendorCandidate("");
                                setVendorInstanceParameter(null);
                                setVendorInstanceValue("");
                                setSpiceDirty(Boolean(chosen));
                                setStatus(chosen ? `${chosen.name} is ready to check.` : "");
                              }}
                            />
                            <span className="vendor-file">{vendorModel?.name ?? "No vendor file selected"}</span>
                            {vendorCandidates.length > 0 && (
                              <select
                                aria-label="Part-level vendor declaration"
                                value={vendorCandidate}
                                onChange={(event) => {
                                  setVendorCandidate(event.target.value);
                                  setVendorInstanceParameter(vendorCandidates.find((candidate) => candidate.id === event.target.value)?.instanceParameter ?? null);
                                  setVendorInstanceValue("");
                                  setSpiceDirty(true);
                                }}
                              >
                                <option value="">Choose the part-level declaration</option>
                                {vendorCandidates.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    .SUBCKT {candidate.name} · {candidate.terminals.join(" ")}
                                  </option>
                                ))}
                              </select>
                            )}
                            {vendorInstanceParameter && (
                              <label className="ask-row-full">
                                <span className="ask-label">Instance {vendorInstanceParameter}</span>
                                <input
                                  value={vendorInstanceValue}
                                  onChange={(event) => {
                                    setVendorInstanceValue(event.target.value);
                                    setSpiceDirty(true);
                                  }}
                                  placeholder={vendorInstanceParameter === "resistance" ? "for example 10k" : vendorInstanceParameter === "capacitance" ? "for example 2.2u" : "length in metres, for example 0.01"}
                                  inputMode="decimal"
                                />
                              </label>
                            )}
                            {vendorModel && (
                              <button type="button" className="btn" disabled={busy || (vendorCandidates.length > 0 && !vendorCandidate) || Boolean(vendorInstanceParameter && !vendorInstanceValue.trim())} onClick={() => void takeTheModel(null, false)}>
                                {vendorCandidates.length > 0 ? "Check this declaration" : "Check this model"}
                              </button>
                            )}
                          </div>
                          {officialResources.some((resource) => resource.kind === "spice") && (
                            <ul className="resource-links" aria-label="Official SPICE resources found automatically">
                              {officialResources.filter((resource) => resource.kind === "spice").map((resource) => (
                                <li key={resource.url}>
                                  <a href={resource.url} target="_blank" rel="noreferrer">{resource.label}</a>
                                  <button type="button" className="btn btn-quiet" disabled={busy || importingOfficial} onClick={() => void useOfficialResource(resource)}>Import</button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {officialImportChoices.find((choice) => choice.kind === "spice") && (() => {
                            const officialImportChoice = officialImportChoices.find((choice) => choice.kind === "spice")!;
                            return (
                            <div className="resource-choice" role="group" aria-labelledby="spice-resource-choice-heading">
                              <p id="spice-resource-choice-heading">
                                <strong>Choose the manufacturer model for this device.</strong>{" "}
                                Forge will inspect its declarations next; helper subcircuits remain a separate choice.
                              </p>
                              <ul className="resource-links">
                                {officialImportChoice.files.map((candidate) => (
                                  <li key={candidate.fileName}>
                                    <span className="vendor-file" title={candidate.fileName}>{candidate.fileName}</span>
                                    <button type="button" className="btn btn-quiet" onClick={() => selectOfficialFile("spice", candidate)}>Use this model</button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            );
                          })()}
                          {spice.vendorVerification.status !== "not-supplied" && (
                            <div className={`vendor-result vendor-result-${spice.vendorVerification.status}`} role="status">
                              {spice.vendorVerification.status === "refused" ? (
                                <p>Could not map this model safely: {spice.vendorVerification.error}</p>
                              ) : spice.vendorVerification.structuralOnly ? (
                                <p>
                                  Accepted {spice.vendorVerification.declaration}. Keep <strong>{spice.vendorVerification.includeName}</strong> beside the adapter and verify this terminal order: {spice.vendorVerification.terminals?.map((terminal, index) => `${index + 1}=${terminal}`).join(", ")}.
                                  No datasheet behaviour was claimed.
                                </p>
                              ) : spice.vendorVerification.simulatorMissing ? (
                                <p>The terminals mapped safely, but this server has no ngspice executable to run the comparison.</p>
                              ) : (
                                <p>
                                  Checked {spice.vendorVerification.checks.length} datasheet targets: {spice.vendorVerification.checks.filter((check) => check.verdict === "pass").length} passed, {spice.vendorVerification.checks.filter((check) => check.verdict === "fail").length} failed, and {spice.vendorVerification.checks.filter((check) => check.verdict === "unverifiable").length} were unverifiable.
                                </p>
                              )}
                            </div>
                          )}
                        </section>
                        {spice.checks.length > 0 && (
                          <table className="spice-checks">
                            <thead>
                              <tr>
                                <th>Parameter</th>
                                <th>Corner</th>
                                <th>Datasheet</th>
                                <th>Simulated</th>
                                <th>Verdict</th>
                              </tr>
                            </thead>
                            <tbody>
                              {spice.checks.map((check, index) => (
                                <tr key={`${check.parameter}-${check.corner}-${index}`} className={`chk chk-${check.verdict}`}>
                                  <td>{check.parameter}</td>
                                  <td>{check.corner}</td>
                                  <td>{check.expected.toPrecision(4)}</td>
                                  {/* An unverifiable check has no measurement, and
                                      a dash is the honest cell. A zero here would
                                      read as a simulation that produced nothing. */}
                                  <td>{check.measured === null ? "—" : check.measured.toPrecision(4)}</td>
                                  <td>{check.verdict}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {/* The alternatives are a QUESTION, not a footnote: a
                            datasheet printing one block per supply cannot say
                            which part is on the bench. */}
                        {spice.alternatives.length > 0 && (
                          <p className="frame-note">
                            This datasheet states {spice.alternatives.length + 1} specification blocks. This model is
                            built from {spice.block.scope ?? "the block with no stated scope"}
                            {/* WHY that one, because the two answers are not
                                equally good. L7805's datasheet carries sixteen
                                blocks captioned L7805A through L7824A: the
                                document naming the part asked for is evidence,
                                and taking the first of sixteen is a coin flip
                                the reader deserves to know about. */}
                            {spice.blockChosenBy === "caption-names-the-part"
                              ? ", which is the one this datasheet captions with that part number."
                              : spice.blockChosenBy === "first-of-several"
                                /* A CLAIM ABOUT THE READING, NOT ABOUT THE
                                   DOCUMENT. "Nothing in the document says
                                   which" asserts an absence across every page,
                                   and this product read the captions it found.
                                   What it knows is that none of THOSE names the
                                   part. `document-claims.test.ts` caught the
                                   first wording of this line. */
                                ? ". No caption read here names the part you asked for, so this is the fullest of them rather than a chosen one. Check the scope against your part."
                                : "."}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="frame-note">
                        {/* A `both` run reads for CAD first, so the model is
                            built when the bundle is taken. Saying "read this
                            datasheet for SPICE" to someone who just did is the
                            screen disagreeing with itself. */}
                        {intent === "both"
                          ? "The model is built when you take the combined bundle."
                          : "Read this datasheet for SPICE to build a model from it."}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {/* WORTH A GLANCE. The values no second reading could check, which
                  is the whole argument of the product stated as a list. Same
                  component `/` renders. Renders nothing when everything was
                  confirmed. */}
              {/* WHAT TO CHECK, from whichever half ran. A model's flags are
                  the same kind of statement as a record's and belong in the
                  same place: one list, so a person does not have to know which
                  pipeline produced a warning to find it. */}
              <WorthAGlance
                items={pendingAssurance.map((item) => ({
                  id: item.id,
                  label: item.label,
                  state: "flagged" as const,
                  detail: item.detail,
                  page: null
                }))}
              />
              {spice && spice.toCheck.filter((item) => item.state === "flagged").length > 0 && (
                <section className="glance">
                  <h2 className="frame-label">Worth a glance, in the model</h2>
                  {spice.overBudget && (
                    <p className="frame-note">
                      More things to check than a person should have to settle. Treat this model as a draft.
                    </p>
                  )}
                  <ul className="glance-list">
                    {spice.toCheck
                      .filter((item) => item.state === "flagged")
                      .map((item) => (
                        <li key={item.id}>
                          <strong>{item.label}</strong>
                          {item.page !== null ? ` · page ${item.page}` : ""}
                          <p>{item.detail}</p>
                          {item.consequence && <p className="frame-note">Why it matters: {item.consequence}</p>}
                        </li>
                      ))}
                  </ul>
                </section>
              )}

              {/* THE FULL RECORD. `HANDOFF.md` names this as the one panel whose
                  absence would not have been noticed: every other missing panel
                  is missing visibly, but the record is a disclosure that is
                  closed by default, so a `done` body without it still looks
                  finished.

                  It is the SAME component `/` renders, imported rather than
                  copied. Two record panels means two screens that can disagree
                  about where a value came from. */}
              {/* THE QUESTIONS, with the drawing each is answered from. The
                  refusal used to name the missing values and give the user
                  nowhere to type them. */}
              {showCad && (
                <AskPanel
                  needs={shownNeeds}
                  drawingPage={drawingPage}
                  imageFor={imageFor}
                  values={needValues}
                  onChange={(field, raw) => setNeedValues((current) => ({ ...current, [field]: raw }))}
                  onSupply={handleSupplyNeed}
                  busy={busy}
                  maxes={{ formedContactMm: MAX_FORMED_CONTACT_MM, leadSpanMm: MAX_LEAD_SPAN_MM }}
                />
              )}

              {showCad && cadLimitations.length > 0 && (
                <section className="step glance">
                  {/* `.step-title` like every other section heading. Bare, this
                      took the browser default: half again the size of the
                      headings around it, with 19px of margin above and below
                      that no other section has. */}
                  <h2 className="step-title">Known CAD limits</h2>
                  <ul className="glance-list">
                    {cadLimitations.map((item) => (
                      <li key={item.id}>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* THE READING ITSELF, folded unless something is blocking. Not a
                  list of things to check: that is the section above, bounded at
                  five. This is every value a model produced, with its page. */}
              <ReviewList review={review} imageFor={imageFor} onConfirm={handleConfirmReview} onCorrect={handleCorrectReview} />

              {part && <RecordPanel part={part} activePackage={chosenPackage} onPartChange={setPart} />}

              {/* WHICH CAD TOOL. This was missing entirely, so the button that
                  did nothing would not have known what to build even if it had
                  fired. Cadence is offered and disabled rather than hidden: a
                  format with no generator is a fact about the product, and
                  hiding it invites the assumption that it is coming. */}
              {showCad && (
                <fieldset className="fmt-set">
                  <legend className="fmt-legend">Bundle format</legend>
                  <div className="fmt-row">
                    {FORMATS.map((option) => (
                      <label
                        key={option.value}
                        className={`fmt${format === option.value ? " fmt-on" : ""}${option.ready ? "" : " fmt-off"}`}
                      >
                        <input
                          type="radio"
                          name="suite-format"
                          value={option.value}
                          checked={format === option.value}
                          disabled={!option.ready || busy}
                          onChange={() => {
                            setFormat(option.value);
                            setRefusal(null);
                            setStatus("");
                          }}
                        />
                        <span className="fmt-name">{option.label}</span>
                        <span className="fmt-note">{option.note}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {/* THE REFUSAL, WITH ITS FIELDS. `/api/export` answers which values
                  it could not stand behind, and the whole argument of the product
                  is that it says so. Collapsing that to "Export failed" throws
                  away the only part the user can act on. */}
              {refusal && (
                <div className="refusal" role="alert">
                  {/* THE HEAD NAMES THE KIND, THE LIST NAMES THE FIELDS. Each
                      kind then carried a second paragraph underneath. Only one
                      of the three told the user what to do next; the other two
                      argued that the refusal was correct, which is not
                      something a person blocked on an export needs to read. */}
                  <p className="refusal-head">
                    {refusal.kind === "needs"
                      ? "Your line has to answer this, in Settings."
                      : refusal.kind === "untraceable"
                        ? "These could not be traced to a page of the datasheet."
                        : refusal.kind === "missing"
                          ? "The datasheet does not state these."
                          : "Forge did not release this model."}
                  </p>
                  <ul className="refusal-fields">
                    {refusal.fields.map((field) => (
                      <li key={field}>{field}</li>
                    ))}
                  </ul>
                  {spiceBlockChoices.length > 0 && (
                    <div className="ask-group">
                      <div className="ask-list">
                        <label className="ask-label" htmlFor="spice-block-choice">Specification conditions or grade</label>
                        <p className="ask-why">Choose only the block whose caption matches the part and conditions you are using.</p>
                        <div className="ask-row spice-block-row">
                          <select
                            id="spice-block-choice"
                            value={spiceBlockChoice}
                            onChange={(event) => setSpiceBlockChoice(event.target.value)}
                          >
                            <option value="">Choose a specification block</option>
                            {spiceBlockChoices.map((choice) => (
                              <option key={choice.index} value={choice.index}>
                                {[choice.scope, choice.group].filter(Boolean).join(" · ") || `Unlabelled block ${choice.index + 1}`}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="btn" disabled={busy || spiceBlockChoice === ""} onClick={() => void takeTheModel(null, false)}>
                            Build from this block
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* A REFUSAL THE USER CAN LIFT, and only where the route said
                      so. `/api/model` returns `asks` for one value and one
                      value only - a fixed regulator's nominal output.
                      Measured on fourteen regulator datasheets, seven state an
                      accuracy and no nominal, because the voltage is an
                      ordering option. Everything else on a specification
                      table is a characterisation the vendor measured, and a box
                      inviting somebody to type one would turn this product into
                      the thing it exists to replace. */}
                  {spiceAsks.length > 0 && (
                    <div className="ask-group">
                      <div className="ask-list">
                        {spiceAsks.map((ask) => (
                          <div className="ask-row-full" key={ask.field}>
                            <label className="ask-label" htmlFor={`spice-${ask.field}`}>
                              {ask.label}
                              <span className="unit"> {ask.unit}</span>
                            </label>
                            {/* WHY IT IS BEING ASKED, above the box. A question
                                with no reason reads as the product having
                                failed; this one is the document being silent,
                                and saying which is the difference between a
                                defect and a fact. */}
                            <p className="ask-why">{ask.why}</p>
                            <div className="ask-row">
                              <input
                                id={`spice-${ask.field}`}
                                type="number"
                                step="any"
                                min="0"
                                max={MAX_SUPPLIED_OUTPUT_V}
                                /* THE UNIT, NEVER AN EXAMPLE VALUE. A seeded
                                   "3.3" is an invitation to accept it. */
                                placeholder={ask.unit}
                                value={spiceAnswers[ask.field] ?? ""}
                                onChange={(event) =>
                                  setSpiceAnswers((previous) => ({ ...previous, [ask.field]: event.target.value }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  if ((spiceAnswers[ask.field] ?? "").trim() !== "") void takeTheModel();
                                }}
                              />
                              <button
                                type="button"
                                className="btn"
                                disabled={busy || (spiceAnswers[ask.field] ?? "").trim() === ""}
                                onClick={() => void takeTheModel()}
                              >
                                Use this
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {spiceCorrectionOptions.length > 0 && spiceCorrectionNeeds.length === 0 && (
                    <div className="ask-group spice-class-review">
                      <p className="ask-why">
                        Forge read a specification table but could not identify the device kind. If one of these descriptions is exactly what the datasheet says this part is, choose it and transcribe the required values from the rendered page. Do not choose by resemblance.
                      </p>
                      <div className="ask-list">
                        {spiceCorrectionOptions.map((option) => (
                          <button
                            type="button"
                            className="btn"
                            key={option.deviceClass}
                            onClick={() => {
                              const parameters = [...new Set([...option.required, ...option.oneOf])];
                              setSpiceReviewDeviceClass(option.deviceClass);
                              setSpiceCorrectionNeeds(parameters.map((parameter) => ({ parameter })));
                              setSpiceCorrectionOptions([]);
                              setStatus(option.oneOf.length > 0
                                ? `Read every required value and at least one of ${option.oneOf.join(" or ")} from the page.`
                                : "Read the required values from the page.");
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {spiceCorrectionNeeds.length > 0 && (
                    <div className="ask-group spice-missing-review">
                      <p className="ask-why">
                        Forge could not read the measured value below. Compare the rendered specification page, then enter exactly what it prints. The page and your correction stay in the receipt.
                      </p>
                      {spiceCorrectionNeeds.map((need) => {
                        const editing = editingSpice === need.parameter && correctionDraft;
                        const label = need.parameter.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
                        return (
                          <div className="ask-row-full" key={need.parameter}>
                            <div className="spice-parameter-head">
                              <strong>{label}</strong>
                              {!editing && (
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => {
                                    setEditingSpice(need.parameter);
                                    setCorrectionDraft({ min: "", typ: "", max: "", unit: "", page: "" });
                                    setStatus("");
                                  }}
                                >
                                  Read it from the page
                                </button>
                              )}
                            </div>
                            {editing && (
                              <div className="spice-correction">
                                <div className="spice-refusal-pages">
                                  {spiceRefusalPages.map((sourcePage) => (
                                    <figure className="spice-page" key={sourcePage.page}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={`data:${sourcePage.mimeType};base64,${sourcePage.base64}`} alt={`Datasheet specification page ${sourcePage.page}`} />
                                      <figcaption>Datasheet page {sourcePage.page}</figcaption>
                                    </figure>
                                  ))}
                                </div>
                                <div className="spice-correction-fields">
                                  {(["min", "typ", "max"] as const).map((corner) => (
                                    <label key={corner}>
                                      <span>{corner}</span>
                                      <input type="number" step="any" value={correctionDraft[corner]} onChange={(event) => setCorrectionDraft({ ...correctionDraft, [corner]: event.target.value })} />
                                    </label>
                                  ))}
                                  <label>
                                    <span>Printed unit</span>
                                    <input value={correctionDraft.unit} onChange={(event) => setCorrectionDraft({ ...correctionDraft, unit: event.target.value })} />
                                  </label>
                                  <label>
                                    <span>Source page</span>
                                    <input type="number" min="1" step="1" value={correctionDraft.page} onChange={(event) => setCorrectionDraft({ ...correctionDraft, page: event.target.value })} />
                                  </label>
                                  <div className="spice-correction-actions">
                                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveSpiceCorrection({ key: need.parameter })}>
                                      Rebuild with reviewed value
                                    </button>
                                    <button type="button" className="btn" disabled={busy} onClick={() => { setEditingSpice(null); setCorrectionDraft(null); }}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {showSpice && vendorUploadAccepted && (
                    <section className="vendor-model" aria-labelledby="vendor-rescue-heading">
                      <div className="vendor-model-head">
                        <div>
                          <h4 id="vendor-rescue-heading">Use the vendor-authored model</h4>
                          <p className="frame-note">
                            Forge can preserve any standalone .SUBCKT terminal order, or a common primitive .MODEL card, without inventing behaviour. Your vendor file stays outside the download.
                          </p>
                        </div>
                        {spiceVendorResource && (
                          <a href={spiceVendorResource.url} target="_blank" rel="noreferrer">
                            {spiceVendorResource.modelKnown ? "Get the known vendor model" : "Check vendor product resources"}
                          </a>
                        )}
                      </div>
                      <div className="vendor-model-controls">
                        <label className="btn" htmlFor="vendor-spice-refusal-file">Choose vendor model</label>
                        <input
                          id="vendor-spice-refusal-file"
                          className="visually-hidden"
                          type="file"
                          accept=".lib,.cir,.sub,.mod,.ckt,.sp,.spi,.inc,.txt,text/plain"
                          onChange={(event) => {
                            const chosen = event.target.files?.[0] ?? null;
                            setVendorModel(chosen);
                            setVendorCandidates([]);
                            setVendorCandidate("");
                            setVendorInstanceParameter(null);
                            setVendorInstanceValue("");
                            setSpiceDirty(Boolean(chosen));
                            setStatus(chosen ? `${chosen.name} is ready to inspect.` : "");
                          }}
                        />
                        <span className="vendor-file">{vendorModel?.name ?? "No vendor file selected"}</span>
                      </div>
                      {vendorCandidates.length > 0 && (
                        <label className="ask-row-full" htmlFor="vendor-candidate">
                          <span className="ask-label">Part-level declaration</span>
                          <select id="vendor-candidate" value={vendorCandidate} onChange={(event) => {
                            setVendorCandidate(event.target.value);
                            setVendorInstanceParameter(vendorCandidates.find((candidate) => candidate.id === event.target.value)?.instanceParameter ?? null);
                            setVendorInstanceValue("");
                          }}>
                            <option value="">Choose; helper subcircuits are listed too</option>
                            {vendorCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.kind === "subckt" ? ".SUBCKT" : `.MODEL ${candidate.modelType}`} {candidate.name} · {candidate.terminals.join(" ")}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {vendorInstanceParameter && (
                        <label className="ask-row-full">
                          <span className="ask-label">Instance {vendorInstanceParameter}</span>
                          <input
                            value={vendorInstanceValue}
                            onChange={(event) => setVendorInstanceValue(event.target.value)}
                            placeholder={vendorInstanceParameter === "resistance" ? "for example 10k" : vendorInstanceParameter === "capacitance" ? "for example 2.2u" : "length in metres, for example 0.01"}
                            inputMode="decimal"
                          />
                        </label>
                      )}
                      {vendorModel && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy || (vendorCandidates.length > 0 && !vendorCandidate) || Boolean(vendorInstanceParameter && !vendorInstanceValue.trim())}
                          onClick={() => void takeTheModel(null, false)}
                        >
                          {vendorCandidates.length > 0 ? "Build adapter for this declaration" : "Inspect and build adapter"}
                        </button>
                      )}
                    </section>
                  )}
                </div>
              )}

              <div className="frame-go">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  // A SPICE MODEL HAS NO PACKAGE, so a package that could not be
                  // settled must not disable it. This read `busy || !packageChoice.ok`
                  // for every intent, which meant a footprint problem greyed out
                  // the button for an artefact that has no footprint, with a
                  // note beside it about a missing dimension the model does not
                  // use. Found by `bench:browser --spice`.
                  disabled={
                    busy ||
                    (intent !== "spice" &&
                      (nothingBuildable || (packageChoice ? !packageChoice.ok : false)))
                  }
                  onClick={() => {
                    // The button's LABEL and what it builds must agree. A SPICE
                    // intent builds a model; "both" builds each in turn.
                    if (intent === "spice") return void takeTheModel();
                    if (intent === "both") {
                      return void takeTheBundle(supplied, false).then((cadBundle) => {
                        if (cadBundle) return takeTheModel(cadBundle);
                      });
                    }
                    return void takeTheBundle();
                  }}
                >
                  {busy
                    ? "Building…"
                    : intent === "spice"
                      ? "Take the model"
                        : intent === "cad"
                        ? "Take the library"
                        : "Take CAD + SPICE"}
                </button>
                {/* Beside the button, not only above it: a greyed primary action
                    with no reason next to it reads as a broken screen. */}
                {intent !== "spice" && packageChoice && !packageChoice.ok && (
                  <span className="frame-note">
                    This reading is missing {packageChoice.blockedBy.join(" and ")}.
                  </span>
                )}
                {status && <span className="frame-status">{status}</span>}
              </div>
            </div>
          )}
        </section>

        {phase === "empty" && <p className="frame-note frame-note-centred">{intentNote(intent)}</p>}
      </main>
    </div>
  );
}
