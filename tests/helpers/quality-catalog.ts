// Synthetic reports exist only in disposable tests; never write this catalog to main.
import { readFileSync } from "node:fs";
import {
  emptyCatalog,
  importBatch,
  startTrial,
  addTrial,
  approve,
  queue,
  checkEntry,
  type Trial,
  type Catalog,
  reopen,
} from "../../packages/puzzle-tools/curation.ts";
import { verify, versions } from "../../packages/puzzle-tools/generator.ts";
import type { Puzzle } from "../../packages/game-core/index.ts";
export function syntheticQualityCatalog(at: string, extras: Puzzle[] = []) {
  const c = emptyCatalog();
  const fixtures = JSON.parse(
    readFileSync("examples/verified_fixture_batch.json", "utf8"),
  ) as { puzzle: Puzzle }[];
  const candidates = [...fixtures, ...extras.map((puzzle) => ({ puzzle }))].map(
    (v, i) => {
      const puzzle = {
          ...v.puzzle,
          puzzle_id: `candidate-${i.toString(16).padStart(12, "0")}`,
          purpose: "design_verification_only" as const,
        },
        verification = verify(puzzle);
      return { puzzle, verification, construction: verification.solution };
    },
  );
  for (let i = 0; i < candidates.length; i += 10)
    importBatch(
      c,
      {
        format_version: 1,
        status: "candidate-only",
        complete: true,
        seed: 1,
        versions,
        requested: candidates.slice(i, i + 10).length,
        candidates: candidates.slice(i, i + 10),
      },
      "synthetic-only",
      "test",
      at,
    );
  const trial: Trial = {
    kind: "human_report",
    trial_id: "synthetic-only",
    device: "phone",
    input: "touch",
    locale: "ja",
    attempt_mode: "first",
    outcome: "completed",
    active_elapsed_ms: 60000,
    hint_count: 0,
    interrupted: false,
    first_piece_placed: true,
    confusion: "none",
  };
  for (const e of c.entries) {
    const id = e.puzzle.puzzle_id;
    startTrial(c, id, "test", at);
    addTrial(c, id, trial, "test", at);
    const check = checkEntry(c, e);
    approve(
      c,
      id,
      {
        reviewer: "test",
        notes: "Synthetic test only",
        accepted_warnings: check.warnings,
        check_hash: check.check_hash,
      },
      at,
    );
    queue(c, id, "test", at);
  }
  return c;
}

// Explicit synthetic editorial action for multi-day tests only. Never imported by
// a production/curation CLI; publication does not refresh reviews automatically.
export function reviewSyntheticStock(c: Catalog, at: string) {
  const eligible = c.entries.filter((e) => !checkEntry(c, e).duplicates.length);
  // Reopen the batch before approving: old future approval orders must not
  // participate in the new editorial sequence.
  for (const e of eligible) {
    reopen(c, e.puzzle.puzzle_id, "test", at);
  }
  for (const e of eligible) {
    const check = checkEntry(c, e);
    approve(
      c,
      e.puzzle.puzzle_id,
      {
        reviewer: "test",
        notes: "Synthetic re-review only",
        accepted_warnings: check.warnings,
        check_hash: check.check_hash,
      },
      at,
    );
    queue(c, e.puzzle.puzzle_id, "test", at);
  }
  c.revision++;
  return c;
}
