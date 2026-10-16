import {
  type Puzzle,
  type Placement,
  canonical,
  complete,
  validatePuzzle,
  orientations,
  placementError,
  signature,
} from "../game-core/index.ts";
import {
  type Candidate,
  type Verification,
  digest,
  verify,
  integer,
  versions,
} from "./generator.ts";
import { geometryKey, geometryVersion } from "./geometry.ts";

export const curationVersion = "onebox-curation-v1";
export type Stage =
  "candidate" | "playtesting" | "approved" | "queued" | "rejected";
export type Band = "low" | "medium" | "high";
export type Warning =
  "repeated_shapes" | "repeated_fixed_profile" | "repeated_solver_band";
export interface Trial {
  kind: "human_report";
  trial_id: string;
  device: "phone" | "desktop";
  input: "touch" | "drag" | "keyboard";
  locale: "ja" | "en";
  attempt_mode: "first" | "practice";
  outcome: "completed" | "unfinished";
  active_elapsed_ms: number;
  hint_count: number;
  interrupted: boolean;
  first_piece_placed: boolean;
  confusion: "none" | "anchor" | "rotation" | "drag" | "other";
}
export interface Review {
  reviewer: string;
  notes: string;
  accepted_warnings: Warning[];
  check_hash: string;
}
export interface HistoryItem {
  sequence: number;
  published_at: string;
  puzzle: Puzzle;
  hash: string;
  solver_nodes: number;
}
export interface History {
  format_version: 1;
  total_released: number;
  items: HistoryItem[];
}
export interface Event {
  action: string;
  at: string;
  actor: string;
  detail: unknown;
  previous_hash: string | null;
  hash: string;
}
export interface Entry extends Candidate {
  geometry_key: string;
  stage: Stage;
  source: {
    batch: string;
    batch_hash: string;
    seed: number;
    versions: typeof versions;
  };
  trials: Trial[];
  review: Review | null;
  events: Event[];
}
export interface Catalog {
  format_version: 1;
  curation_version: typeof curationVersion;
  geometry_version: typeof geometryVersion;
  revision: number;
  history: History;
  entries: Entry[];
  history_events: Event[];
}
export function emptyCatalog(): Catalog {
  return {
    format_version: 1,
    curation_version: curationVersion,
    geometry_version: geometryVersion,
    revision: 0,
    history: { format_version: 1, total_released: 0, items: [] },
    entries: [],
    history_events: [],
  };
}
export const label = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v))
    throw Error("Invalid identifier or actor label");
  return v;
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Invalid record");
  return v as Record<string, unknown>;
};
function fields(v: Record<string, unknown>, keys: string[]) {
  if (Object.keys(v).length !== keys.length || keys.some((k) => !(k in v)))
    throw Error("Unexpected record fields");
}
function timestamp(s: unknown): string {
  if (
    typeof s !== "string" ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString() !== s
  )
    throw Error("Expected UTC ISO timestamp");
  return s;
}
function event(
  events: Event[],
  action: string,
  actor: string,
  detail: unknown,
  at: string,
) {
  label(actor);
  timestamp(at);
  const body = {
    action,
    at,
    actor,
    detail,
    previous_hash: events.at(-1)?.hash ?? null,
  };
  events.push({ ...body, hash: digest(body) });
}
function eventsValid(events: Event[]) {
  if (!Array.isArray(events) || events.length > 5000)
    throw Error("Invalid audit events");
  let previous: string | null = null;
  for (const e of events) {
    const { hash, ...body } = e;
    label(e.actor);
    timestamp(e.at);
    if (body.previous_hash !== previous || digest(body) !== hash)
      throw Error("Audit integrity mismatch");
    previous = hash;
  }
}
export function validateTrial(raw: unknown): Trial {
  const v = object(raw);
  fields(v, [
    "kind",
    "trial_id",
    "device",
    "input",
    "locale",
    "attempt_mode",
    "outcome",
    "active_elapsed_ms",
    "hint_count",
    "interrupted",
    "first_piece_placed",
    "confusion",
  ]);
  if (
    v.kind !== "human_report" ||
    !["phone", "desktop"].includes(String(v.device)) ||
    !["touch", "drag", "keyboard"].includes(String(v.input)) ||
    !["ja", "en"].includes(String(v.locale)) ||
    !["first", "practice"].includes(String(v.attempt_mode)) ||
    !["completed", "unfinished"].includes(String(v.outcome)) ||
    !["none", "anchor", "rotation", "drag", "other"].includes(
      String(v.confusion),
    ) ||
    typeof v.interrupted !== "boolean" ||
    typeof v.first_piece_placed !== "boolean"
  )
    throw Error("Invalid human trial report");
  label(v.trial_id);
  integer(Number(v.active_elapsed_ms), "active elapsed", 1, 86400000);
  integer(Number(v.hint_count), "hint count", 0, 100);
  if (
    typeof v.active_elapsed_ms !== "number" ||
    typeof v.hint_count !== "number" ||
    (v.outcome === "completed" && !v.first_piece_placed)
  )
    throw Error("Inconsistent human trial report");
  return structuredClone(v) as unknown as Trial;
}
export function validateHistory(raw: unknown): History {
  const v = object(raw);
  fields(v, ["format_version", "total_released", "items"]);
  if (
    v.format_version !== 1 ||
    typeof v.total_released !== "number" ||
    !Array.isArray(v.items)
  )
    throw Error("Invalid history");
  integer(v.total_released, "released count", 0, 1000000);
  if (v.items.length !== Math.min(180, v.total_released))
    throw Error(
      "History must cover the latest 180 releases, or all releases if fewer",
    );
  const seen = new Set<string>();
  let previousTime = -Infinity;
  for (const [i, rawItem] of v.items.entries()) {
    const item = object(rawItem);
    fields(item, [
      "sequence",
      "published_at",
      "puzzle",
      "hash",
      "solver_nodes",
    ]);
    const p = validatePuzzle(item.puzzle),
      time = Date.parse(timestamp(item.published_at));
    if (
      p.purpose !== "production_daily" ||
      item.sequence !== v.total_released - v.items.length + i + 1 ||
      time < previousTime ||
      item.hash !== digest(p) ||
      seen.has(p.puzzle_id) ||
      typeof item.solver_nodes !== "number"
    )
      throw Error("Invalid history sequence, hash or purpose");
    integer(item.solver_nodes, "history solver nodes", 1, 1000000);
    previousTime = time;
    seen.add(p.puzzle_id);
  }
  return structuredClone(v) as unknown as History;
}
export function validateCatalog(raw: unknown): Catalog {
  const c = object(raw);
  fields(c, [
    "format_version",
    "curation_version",
    "geometry_version",
    "revision",
    "history",
    "entries",
    "history_events",
  ]);
  if (
    c.format_version !== 1 ||
    c.curation_version !== curationVersion ||
    c.geometry_version !== geometryVersion ||
    typeof c.revision !== "number" ||
    !Array.isArray(c.entries) ||
    c.entries.length > 500
  )
    throw Error("Invalid catalog");
  integer(c.revision, "revision", 0, 1000000);
  validateHistory(c.history);
  eventsValid(c.history_events as Event[]);
  const seen = new Set<string>();
  for (const rawEntry of c.entries) {
    const e = object(rawEntry);
    fields(e, [
      "puzzle",
      "construction",
      "verification",
      "geometry_key",
      "stage",
      "source",
      "trials",
      "review",
      "events",
    ]);
    const p = validatePuzzle(e.puzzle);
    if (
      p.purpose !== "design_verification_only" ||
      seen.has(p.puzzle_id) ||
      e.geometry_key !== geometryKey(p) ||
      !["candidate", "playtesting", "approved", "queued", "rejected"].includes(
        String(e.stage),
      ) ||
      !Array.isArray(e.trials) ||
      e.trials.length > 1000
    )
      throw Error("Invalid candidate entry");
    seen.add(p.puzzle_id);
    const source = object(e.source);
    fields(source, ["batch", "batch_hash", "seed", "versions"]);
    label(source.batch);
    integer(Number(source.seed), "seed", 0, 4294967295);
    if (
      typeof source.seed !== "number" ||
      typeof source.batch_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(source.batch_hash) ||
      canonical(source.versions) !== canonical(versions)
    )
      throw Error("Invalid source provenance");
    const v = e.verification as Verification;
    if (
      v.status !== "unique" ||
      v.count !== 1 ||
      v.aborted !== false ||
      v.hash !== digest(p) ||
      !complete(p, e.construction as Placement[]) ||
      !complete(p, v.solution ?? [])
    )
      throw Error("Invalid verification or construction");
    integer(v.nodes, "solver nodes", 1, 1000000);
    const trials = (e.trials as unknown[]).map(validateTrial);
    if (new Set(trials.map((t) => t.trial_id)).size !== trials.length)
      throw Error("Duplicate human trial IDs");
    if (
      ["approved", "queued"].includes(String(e.stage)) &&
      (!trials.some((t) => t.outcome === "completed" && t.device === "phone") ||
        !e.review)
    )
      throw Error("Human phone completion and editorial review required");
    if (e.review) validateReview(e.review);
    eventsValid(e.events as Event[]);
  }
  return structuredClone(c) as unknown as Catalog;
}
export function solverBand(nodes: number): Band {
  return nodes < 25 ? "low" : nodes < 100 ? "medium" : "high";
}
function features(p: Puzzle, nodes: number) {
  const corners = p.board.blocked.filter(
    ([x, y]) => [0, 4].includes(x) && [0, 4].includes(y),
  ).length;
  const edges = p.board.blocked.filter(
    ([x, y]) => [0, 4].includes(x) || [0, 4].includes(y),
  ).length;
  return {
    shapes: canonical(p.pieces.map((s) => signature(s.cells)).sort()),
    fixed: canonical({ corners, edges }),
    band: solverBand(nodes),
  };
}
export function machineMetrics(p: Puzzle, nodes: number) {
  return {
    solver_nodes: nodes,
    solver_band: solverBand(nodes),
    initial_legal_placements: p.pieces.map((piece) => ({
      piece: piece.id,
      count: orientations(piece.cells).reduce(
        (n, o) =>
          n +
          Array.from({ length: 25 }, (_, i) => ({
            piece_id: piece.id,
            rotation: o.rotation,
            x: i % 5,
            y: Math.floor(i / 5),
          })).filter((q) => !placementError(p, [], q)).length,
        0,
      ),
    })),
  };
}
export function trialSummary(trials: Trial[]) {
  const first = trials.filter((t) => t.attempt_mode === "first");
  const firstTimes = first
    .filter((t) => t.outcome === "completed")
    .map((t) => t.active_elapsed_ms)
    .sort((a, b) => a - b);
  const done = trials.filter((t) => t.outcome === "completed"),
    times = done.map((t) => t.active_elapsed_ms).sort((a, b) => a - b);
  const midpoint = times.length / 2;
  const median = times.length
    ? times.length % 2
      ? times[Math.floor(midpoint)]
      : (times[midpoint - 1] + times[midpoint]) / 2
    : null;
  return {
    starts: trials.length,
    completed: done.length,
    unfinished: trials.length - done.length,
    first_piece_placed: trials.filter((t) => t.first_piece_placed).length,
    used_hint: trials.filter((t) => t.hint_count > 0).length,
    interrupted: trials.filter((t) => t.interrupted).length,
    confused: trials.filter((t) => t.confusion !== "none").length,
    completion_median_ms: median,
    first_starts: first.length,
    first_completed: firstTimes.length,
    first_completion_median_ms: firstTimes.length
      ? firstTimes.length % 2
        ? firstTimes[Math.floor(firstTimes.length / 2)]
        : (firstTimes[firstTimes.length / 2 - 1] +
            firstTimes[firstTimes.length / 2]) /
          2
      : null,
    unassisted_completed: done.filter((t) => t.hint_count === 0).length,
  };
}
export function findEntry(c: Catalog, id: string) {
  const e = c.entries.find((e) => e.puzzle.puzzle_id === id);
  if (!e) throw Error("Candidate not found");
  return e;
}
export function checkEntry(c: Catalog, e: Entry) {
  const order = (entry: Entry) => {
    const detail = entry.events
      .filter((event) => event.action === "approve")
      .at(-1)?.detail as { order?: number } | undefined;
    return detail?.order ?? 0;
  };
  const key = geometryKey(e.puzzle);
  const duplicateIds = [
    ...c.history.items
      .filter((h) => geometryKey(h.puzzle) === key)
      .map((h) => h.puzzle.puzzle_id),
    ...c.entries
      .filter(
        (other) =>
          other !== e &&
          other.stage !== "rejected" &&
          other.geometry_key === key,
      )
      .map((other) => other.puzzle.puzzle_id),
  ];
  const prior = [
    ...c.history.items.map((h) => features(h.puzzle, h.solver_nodes)),
    ...c.entries
      .filter(
        (other) => other !== e && ["approved", "queued"].includes(other.stage),
      )
      // Later approvals are future stock, not predecessors of this reviewed entry.
      .filter(
        (other) =>
          !["approved", "queued"].includes(e.stage) || order(other) < order(e),
      )
      .sort(
        (a, b) =>
          order(a) - order(b) ||
          a.puzzle.puzzle_id.localeCompare(b.puzzle.puzzle_id),
      )
      .map((other) => features(other.puzzle, other.verification.nodes)),
  ].slice(-2);
  const current = features(e.puzzle, e.verification.nodes),
    warnings: Warning[] = [];
  if (prior.length === 2) {
    if (prior.every((f) => f.shapes === current.shapes))
      warnings.push("repeated_shapes");
    if (prior.every((f) => f.fixed === current.fixed))
      warnings.push("repeated_fixed_profile");
    if (prior.every((f) => f.band === current.band))
      warnings.push("repeated_solver_band");
  }
  const body = {
    context_version: "onebox-review-context-v2",
    puzzle_hash: digest(e.puzzle),
    geometry_key: key,
    history_hash: digest(c.history),
    other_candidates: c.entries
      .filter((other) => other !== e && other.stage !== "rejected")
      .map((other) => ({
        id: other.puzzle.puzzle_id,
        geometry_key: other.geometry_key,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    duplicates: [...new Set(duplicateIds)],
    warnings,
    trials_hash: digest(e.trials),
    metrics: machineMetrics(e.puzzle, e.verification.nodes),
  };
  return {
    ...body,
    check_hash: digest(body),
    history_checked: c.history.items.length,
    history_total: c.history.total_released,
  };
}
function eligible(c: Catalog, e: Entry) {
  const check = checkEntry(c, e);
  if (check.duplicates.length) throw Error("Geometric duplicate blocked");
  return check;
}
export function importBatch(
  c: Catalog,
  raw: unknown,
  batchName: string,
  actor: string,
  at: string,
) {
  const batch = object(raw);
  if (
    batch.format_version !== 1 ||
    batch.status !== "candidate-only" ||
    batch.complete !== true ||
    canonical(batch.versions) !== canonical(versions) ||
    !Array.isArray(batch.candidates) ||
    batch.candidates.length < 1 ||
    batch.candidates.length > 10 ||
    batch.requested !== batch.candidates.length ||
    typeof batch.seed !== "number"
  )
    throw Error("Expected complete supported candidate batch");
  label(batchName);
  label(actor);
  timestamp(at);
  integer(batch.seed, "seed", 0, 4294967295);
  if (c.entries.length + batch.candidates.length > 500)
    throw Error("Catalog capacity reached");
  const added: Entry[] = [];
  for (const rawItem of batch.candidates) {
    const item = object(rawItem);
    fields(item, ["puzzle", "construction", "verification"]);
    const p = validatePuzzle(item.puzzle),
      old = item.verification as Verification;
    const v = verify(p);
    if (
      p.purpose !== "design_verification_only" ||
      v.status !== "unique" ||
      old.status !== "unique" ||
      old.count !== 1 ||
      old.aborted !== false ||
      old.nodes !== v.nodes ||
      old.hash !== v.hash ||
      !complete(p, item.construction as Placement[]) ||
      !complete(p, old.solution ?? []) ||
      c.entries.some((e) => e.puzzle.puzzle_id === p.puzzle_id) ||
      added.some((e) => e.puzzle.puzzle_id === p.puzzle_id)
    )
      throw Error("Invalid, duplicate ID or unproven candidate");
    const e: Entry = {
      puzzle: structuredClone(p),
      construction: structuredClone(item.construction) as Placement[],
      verification: v,
      geometry_key: geometryKey(p),
      stage: "candidate",
      source: {
        batch: batchName,
        batch_hash: digest(raw),
        seed: batch.seed,
        versions: structuredClone(versions),
      },
      trials: [],
      review: null,
      events: [],
    };
    event(
      e.events,
      "import",
      actor,
      {
        batch: batchName,
        batch_hash: e.source.batch_hash,
        puzzle_hash: v.hash,
      },
      at,
    );
    added.push(e);
  }
  c.entries.push(...added);
  return added.map((e) => ({
    id: e.puzzle.puzzle_id,
    stage: e.stage,
    ...checkEntry(c, e),
  }));
}
export function startTrial(c: Catalog, id: string, actor: string, at: string) {
  const e = findEntry(c, id);
  if (e.stage !== "candidate") throw Error("Expected candidate stage");
  const check = eligible(c, e);
  event(e.events, "trial-start", actor, { check_hash: check.check_hash }, at);
  e.stage = "playtesting";
}
export function addTrial(
  c: Catalog,
  id: string,
  raw: unknown,
  actor: string,
  at: string,
) {
  const e = findEntry(c, id);
  if (e.stage !== "playtesting") throw Error("Expected playtesting stage");
  const trial = validateTrial(raw);
  if (e.trials.some((t) => t.trial_id === trial.trial_id))
    throw Error("Trial ID already recorded");
  if (e.trials.length >= 1000) throw Error("Trial capacity reached");
  event(e.events, "trial-report", actor, { trial }, at);
  e.trials.push(trial);
}
function validateReview(raw: unknown): Review {
  const r = object(raw);
  fields(r, ["reviewer", "notes", "accepted_warnings", "check_hash"]);
  label(r.reviewer);
  if (
    typeof r.notes !== "string" ||
    !r.notes.trim() ||
    r.notes.length > 1000 ||
    typeof r.check_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(r.check_hash) ||
    !Array.isArray(r.accepted_warnings) ||
    r.accepted_warnings.some(
      (w) =>
        ![
          "repeated_shapes",
          "repeated_fixed_profile",
          "repeated_solver_band",
        ].includes(String(w)),
    ) ||
    new Set(r.accepted_warnings).size !== r.accepted_warnings.length
  )
    throw Error("Invalid editorial review");
  return structuredClone(r) as unknown as Review;
}
export function approve(c: Catalog, id: string, raw: unknown, at: string) {
  const e = findEntry(c, id);
  if (
    e.stage !== "playtesting" ||
    !e.trials.some((t) => t.device === "phone" && t.outcome === "completed")
  )
    throw Error("Human phone completion required before approval");
  const review = validateReview(raw),
    check = eligible(c, e);
  if (
    review.check_hash !== check.check_hash ||
    canonical([...review.accepted_warnings].sort()) !==
      canonical([...check.warnings].sort())
  )
    throw Error("Editorial review must match current checks and all warnings");
  if (verify(e.puzzle).status !== "unique")
    throw Error("Uniqueness recheck failed");
  event(
    e.events,
    "approve",
    review.reviewer,
    {
      review,
      summary: trialSummary(e.trials),
      order:
        Math.max(
          0,
          ...c.entries.flatMap((entry) =>
            entry.events
              .filter((item) => item.action === "approve")
              .map((item) => (item.detail as { order?: number }).order ?? 0),
          ),
        ) + 1,
    },
    at,
  );
  e.review = review;
  e.stage = "approved";
}
export function queue(c: Catalog, id: string, actor: string, at: string) {
  const e = findEntry(c, id);
  if (e.stage !== "approved" || !e.review)
    throw Error("Editorial approval required before queuing");
  const check = eligible(c, e);
  if (e.review.check_hash !== check.check_hash)
    throw Error("Checks changed; reopen for editorial review");
  if (verify(e.puzzle).status !== "unique")
    throw Error("Uniqueness recheck failed");
  event(e.events, "queue", actor, { check_hash: check.check_hash }, at);
  e.stage = "queued";
}
export function reject(
  c: Catalog,
  id: string,
  actor: string,
  notes: string,
  at: string,
) {
  const e = findEntry(c, id);
  if (e.stage === "rejected" || !notes.trim() || notes.length > 1000)
    throw Error("Rejection requires active candidate and notes");
  event(e.events, "reject", actor, { notes }, at);
  e.stage = "rejected";
  e.review = null;
}
export function reopen(c: Catalog, id: string, actor: string, at: string) {
  const e = findEntry(c, id);
  if (!["approved", "queued", "rejected"].includes(e.stage))
    throw Error("Expected approved, queued or rejected stage");
  eligible(c, e);
  event(e.events, "reopen", actor, {}, at);
  e.stage = "playtesting";
  e.review = null;
}
export function replaceHistory(
  c: Catalog,
  raw: unknown,
  actor: string,
  at: string,
) {
  const history = validateHistory(raw);
  if (history.total_released < c.history.total_released)
    throw Error("History cannot move backwards");
  for (const old of c.history.items) {
    const current = history.items.find((h) => h.sequence === old.sequence);
    if (current && canonical(current) !== canonical(old))
      throw Error("Published history is immutable");
  }
  event(
    c.history_events,
    "history-import",
    actor,
    {
      history_hash: digest(history),
      total: history.total_released,
      checked: history.items.length,
    },
    at,
  );
  c.history = history;
}
