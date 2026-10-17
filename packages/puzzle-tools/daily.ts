import {
  validateManifest,
  utcDate,
  nextUtcUpdate,
  dailyEntry,
  validateArchive,
  type PublicArchive,
  type ReleaseManifest,
} from "../game-core/release.ts";
import { validatePuzzle, canonical } from "../game-core/index.ts";
import {
  validateCatalog,
  findEntry,
  checkEntry,
  type Catalog,
} from "./curation.ts";
import { inventory } from "./inventory.ts";
import { verify, digest } from "./generator.ts";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../../", import.meta.url));

// Preparation is private and read-only. It cannot promote an app or mutate reviews.
export function prepareDaily(
  raw: Catalog,
  id: string,
  edition: string,
  at: string,
  previous?: ReleaseManifest,
  previousArchive?: PublicArchive,
) {
  const c = validateCatalog(raw),
    day = utcDate(edition);
  if (day !== new Date(at).toISOString().slice(0, 10))
    throw Error("Cannot release a future or backdated edition");
  const old = previous ? validateManifest(previous) : undefined;
  const prior = old
    ? previousArchive
      ? validateArchive(previousArchive, old).entries
      : [
          ...new Map(
            [
              ...old.recent,
              ...c.history.items.map((h) => dailyEntry(h.puzzle, h.hash)),
            ].map((e) => [e.puzzle_id, e]),
          ).values(),
        ].sort((a, b) => b.edition_utc!.localeCompare(a.edition_utc!))
    : [];
  const publicId = `onebox-${day}`;
  if (
    old?.stage === "daily" &&
    (prior.some((p) => p.puzzle_id === publicId) ||
      old.recalled_ids.includes(publicId) ||
      old.active.edition_utc! >= day)
  )
    throw Error("Published or recalled IDs are immutable");
  if (
    old?.archive &&
    !previousArchive &&
    old.archive.count > c.history.items.length
  )
    throw Error("Complete previous archive required");
  if (old?.archive && old.archive.count !== c.history.total_released)
    throw Error("Archive publication count mismatch");
  if (
    previousArchive &&
    (previousArchive.entries.length !== c.history.total_released ||
      (old?.archive && digest(previousArchive) !== old.archive.sha256))
  )
    throw Error("Previous archive integrity mismatch");
  if (old && at < old.published_at)
    throw Error("Daily time must not move backwards");
  if (c.history.total_released) {
    if (old?.stage !== "daily") throw Error("Previous daily manifest required");
    for (const h of c.history.items) {
      const entry = prior.find((p) => p.puzzle_id === h.puzzle.puzzle_id);
      if (
        (!entry && !old.recalled_ids.includes(h.puzzle.puzzle_id)) ||
        (entry &&
          (entry.sha256 !== h.hash ||
            entry.edition_utc !== h.puzzle.puzzle_id.slice(7)))
      )
        throw Error("Published history/manifest mismatch");
    }
    if (
      old.recent.some(
        (p) =>
          !prior.some(
            (h) =>
              h.puzzle_id === p.puzzle_id &&
              h.sha256 === p.sha256 &&
              (previousArchive ||
                c.history.items.some((item) => item.hash === h.sha256)),
          ),
      )
    )
      throw Error("Published history/manifest mismatch: unknown history");
  } else if (old?.stage === "daily")
    throw Error("Previous manifest requires published history");
  const stock = inventory(c, at);
  if (stock.ready < 30)
    throw Error("30 currently eligible quality-reviewed puzzles required");
  const e = findEntry(c, id),
    check = checkEntry(c, e);
  if (
    e.stage !== "queued" ||
    !e.review ||
    e.review.check_hash !== check.check_hash ||
    check.duplicates.length
  )
    throw Error("Current queued review required");
  const puzzle = validatePuzzle({
    ...structuredClone(e.puzzle),
    puzzle_id: `onebox-${day}`,
    purpose: "production_daily",
  });
  const verification = verify(puzzle);
  if (verification.status !== "unique")
    throw Error("Final payload uniqueness required");
  const hash = digest(puzzle);
  const active = {
    puzzle_id: puzzle.puzzle_id,
    purpose: "production_daily" as const,
    edition_utc: day,
    slug: puzzle.puzzle_id,
    payload_url: `/puzzles/${hash}.json`,
    sha256: hash,
    opens_at: `${day}T00:00:00.000Z`,
    scheduled_close_at: nextUtcUpdate(`${day}T00:00:00.000Z`),
  };
  const archive: PublicArchive = {
    archive_version: 1,
    entries: [active, ...prior],
  };
  const archiveHash = digest(archive);
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "daily",
    published_at: at,
    release_status: "ready",
    active,
    next_update_at: nextUtcUpdate(at),
    recent: archive.entries.slice(0, 180),
    recalled_ids: old?.stage === "daily" ? old.recalled_ids : [],
    archive: {
      url: `/archives/${archiveHash}.json`,
      sha256: archiveHash,
      count: archive.entries.length,
    },
  });
  validateArchive(archive, manifest);
  // Two independent Python solvers plus JS/Python canonical hash agreement.
  try {
    const report = JSON.parse(
      execFileSync("python3", ["-E", "verification/check_candidates.py", "-"], {
        cwd: project,
        input: JSON.stringify([puzzle]),
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 100000,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    if (
      report.checked !== 1 ||
      report.reports[0].exact_cover_count !== 1 ||
      report.reports[0].independent_dfs_count !== 1 ||
      report.reports[0].hash !== hash
    )
      throw Error();
  } catch {
    throw Error("Independent final payload verification failed");
  }
  return {
    plan_version: 1 as const,
    manifest,
    payload_json: canonical(puzzle),
    source_id: id,
    source_revision: c.revision,
    source_catalog_hash: digest(c),
    previous_manifest_hash: old ? digest(old) : null,
    check_hash: check.check_hash,
    solver_nodes: verification.nodes,
  };
}

export type DailyPlan = ReturnType<typeof prepareDaily>;

// A private plan is not an authorization token. Recompute it from current reviews
// and history; do not trust a saved payload, revision, solver count or metadata.
export function validateDailyPlan(
  raw: unknown,
  catalog: Catalog,
  at: string,
  previous?: ReleaseManifest,
  previousArchive?: PublicArchive,
): DailyPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("Invalid daily plan");
  const plan = raw as DailyPlan;
  const manifest = validateManifest(plan.manifest);
  if (
    manifest.stage !== "daily" ||
    manifest.active.edition_utc !== new Date(at).toISOString().slice(0, 10)
  )
    throw Error("Daily plan has expired or is not for this UTC day");
  if (
    plan.source_revision !== catalog.revision ||
    plan.source_catalog_hash !== digest(catalog)
  )
    throw Error("Daily plan is stale; prepare from the current catalog");
  const checked = prepareDaily(
    catalog,
    plan.source_id,
    manifest.active.edition_utc!,
    manifest.published_at,
    previous,
    previousArchive,
  );
  if (digest(checked) !== digest(plan))
    throw Error("Daily plan integrity mismatch");
  return checked;
}
