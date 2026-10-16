import {
  validateManifest,
  utcDate,
  nextUtcUpdate,
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

// Preparation is private and read-only. It cannot promote an app or mutate reviews.
export function prepareDaily(
  raw: Catalog,
  id: string,
  edition: string,
  at: string,
  previous?: ReleaseManifest,
) {
  const c = validateCatalog(raw),
    day = utcDate(edition);
  if (day !== new Date(at).toISOString().slice(0, 10))
    throw Error("Cannot release a future or backdated edition");
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
  const old = previous ? validateManifest(previous) : undefined;
  if (
    old?.stage === "daily" &&
    (old.recent.some((p) => p.puzzle_id === puzzle.puzzle_id) ||
      old.recalled_ids.includes(puzzle.puzzle_id) ||
      old.active.edition_utc! >= day)
  )
    throw Error("Published or recalled IDs are immutable");
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
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "daily",
    published_at: at,
    release_status: "ready",
    active,
    next_update_at: nextUtcUpdate(at),
    recent: [active, ...(old?.stage === "daily" ? old.recent : [])].slice(
      0,
      180,
    ),
    recalled_ids: old?.stage === "daily" ? old.recalled_ids : [],
  });
  // Two independent Python solvers plus JS/Python canonical hash agreement.
  try {
    const report = JSON.parse(
      execFileSync("python3", ["-E", "verification/check_candidates.py", "-"], {
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
    manifest,
    payload_json: canonical(puzzle),
    source_id: id,
    source_revision: c.revision,
    check_hash: check.check_hash,
    solver_nodes: verification.nodes,
  };
}
