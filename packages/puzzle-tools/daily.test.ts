import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prepareDaily } from "./daily.ts";
import {
  emptyCatalog,
  importBatch,
  startTrial,
  addTrial,
  approve,
  queue,
  checkEntry,
  type Trial,
} from "./curation.ts";
import { digest, verify, versions } from "./generator.ts";
import { inventory } from "./inventory.ts";
import type { Puzzle } from "../game-core/index.ts";
const at = "2026-10-14T00:00:01.000Z";
it("blocks unreviewed stock and future/backdated editions without mutating the real-empty model", () => {
  const c = emptyCatalog(),
    before = digest(c);
  expect(() => prepareDaily(c, "candidate-none", "2026-10-14", at)).toThrow(
    "30",
  );
  expect(() => prepareDaily(c, "candidate-none", "2026-10-15", at)).toThrow(
    "future",
  );
  expect(() => prepareDaily(c, "candidate-none", "2026-10-13", at)).toThrow(
    "backdated",
  );
  expect(() => prepareDaily(c, "candidate-none", "2026-02-30", at)).toThrow(
    "edition",
  );
  expect(digest(c)).toBe(before);
});
it("prepares one final canonical payload from 30 synthetic queued entries, with independent solvers; refuses ID reuse", () => {
  const c = emptyCatalog();
  const fixtures = JSON.parse(
    readFileSync("examples/verified_fixture_batch.json", "utf8"),
  ) as { puzzle: Puzzle }[];
  const candidates = fixtures.map((v, i) => {
    const puzzle = {
        ...v.puzzle,
        puzzle_id: `candidate-${i.toString(16).padStart(12, "0")}`,
        purpose: "design_verification_only" as const,
      },
      verification = verify(puzzle);
    return { puzzle, verification, construction: verification.solution };
  });
  for (let i = 0; i < 30; i += 10)
    importBatch(
      c,
      {
        format_version: 1,
        status: "candidate-only",
        complete: true,
        seed: 1,
        versions,
        requested: 10,
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
  expect(inventory(c, at).ready).toBe(30);
  const before = digest(c),
    result = prepareDaily(c, c.entries[0].puzzle.puzzle_id, "2026-10-14", at);
  expect(result.manifest.active.puzzle_id).toBe("onebox-2026-10-14");
  expect(result.manifest.next_update_at).toBe("2026-10-15T00:00:00.000Z");
  expect(result.payload_json).not.toMatch(
    /seed|solution|construction|trials|reviewer|PRIVATE/,
  );
  expect(digest(JSON.parse(result.payload_json))).toBe(
    result.manifest.active.sha256,
  );
  expect(digest(c)).toBe(before);
  expect(() =>
    prepareDaily(
      c,
      c.entries[0].puzzle.puzzle_id,
      "2026-10-14",
      at,
      result.manifest,
    ),
  ).toThrow("immutable");
}, 10000);
