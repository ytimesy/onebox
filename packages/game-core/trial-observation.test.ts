import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { digest } from "../puzzle-tools/generator.ts";
import { validateTrial } from "../puzzle-tools/curation.ts";
import { validatePuzzle, type Attempt } from "./index.ts";
import { observe, humanReport } from "./trial-observation.ts";
const p = validatePuzzle(
  JSON.parse(readFileSync("examples/sample_puzzle.json", "utf8")),
);
const hash = digest(p);
const placements = JSON.parse(
  readFileSync("examples/sample_solution.PRIVATE.json", "utf8"),
).placements;
function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    record_version: 1,
    run_id: "test-run-1",
    puzzle_id: p.puzzle_id,
    puzzle_hash: hash,
    rules_version: p.rules_version,
    mode: "first",
    state: "paused",
    placements: [],
    active_elapsed_ms: 1234.6,
    interrupted: true,
    clock_status: "continuous",
    hint_count: 0,
    timer_visible: true,
    started_at_client: "2026-10-12T01:00:00.000Z",
    ...overrides,
    finished_at_client: ["completed", "revealed", "abandoned"].includes(
      overrides.state ?? "paused",
    )
      ? "2026-10-12T01:01:00.000Z"
      : (overrides.finished_at_client ?? null),
  };
}
const choices = {
  confirmed: true,
  device: "desktop" as const,
  input: "touch" as const,
  confusion: "anchor" as const,
};
it("keeps a placed-then-undone piece, but does not transfer it to another run", () => {
  const first = observe(attempt({ placements: placements.slice(0, 1) }), "ja");
  const undone = observe(attempt(), "en", first);
  expect(undone.first_piece_placed).toBe(true);
  const next = observe(
    attempt({ run_id: "test-run-2", mode: "practice" }),
    "ja",
    undone,
  );
  expect(next.first_piece_placed).toBe(false);
  expect(first.kind).toBe("browser_observation");
});
it("requires confirmation and exports only the CLI's strict human-report fields", () => {
  const o = observe(attempt(), "ja");
  expect(() =>
    humanReport(o, p, hash, { ...choices, confirmed: false }),
  ).toThrow();
  const r = humanReport(o, p, hash, choices);
  expect(validateTrial(r)).toEqual(r);
  expect(r).toMatchObject({
    outcome: "unfinished",
    attempt_mode: "first",
    active_elapsed_ms: 1235,
    first_piece_placed: false,
  });
  expect(JSON.stringify(r)).not.toMatch(
    /placements|puzzle_hash|started_at|seed/,
  );
});
it("counts reveal and abandonment as unfinished, and keeps hint/practice/interruption", () => {
  for (const state of ["revealed", "abandoned"] as const) {
    const o = observe(
      attempt({ state, placements, hint_count: 2, mode: "practice" }),
      "en",
    );
    expect(humanReport(o, p, hash, choices)).toMatchObject({
      outcome: "unfinished",
      hint_count: 2,
      attempt_mode: "practice",
      interrupted: true,
      locale: "en",
    });
  }
  const completed = observe(
    attempt({ state: "completed", placements, interrupted: false }),
    "ja",
  );
  expect(validateTrial(humanReport(completed, p, hash, choices)).outcome).toBe(
    "completed",
  );
});
it("does not count displayed solution pieces as human placements", () => {
  const revealOnly = observe(attempt({ state: "revealed", placements }), "ja");
  expect(humanReport(revealOnly, p, hash, choices).first_piece_placed).toBe(
    false,
  );
});
it("rejects false completion, wrong hash, clock uncertainty and invalid time", () => {
  const cases: Partial<Attempt>[] = [
    { state: "completed" },
    { puzzle_hash: "0".repeat(64) },
    { clock_status: "uncertain" },
    { active_elapsed_ms: 0 },
    { active_elapsed_ms: 86400001 },
    { hint_count: 101 },
    { mode: "tutorial" },
    { run_id: "invalid/run" },
  ];
  for (const c of cases)
    expect(() =>
      humanReport(observe(attempt(c), "ja"), p, hash, choices),
    ).toThrow();
});
