import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  validatePuzzle,
  rotate,
  signature,
  commit,
  placementError,
  complete,
  canonical,
  sixtyTag,
  validateAttempt,
  hint,
  orientations,
  type Puzzle,
  type Attempt,
  type Placement,
} from "./index";
import { solve } from "./solver";
const json = (f: string) =>
  JSON.parse(
    readFileSync(new URL(`../../examples/${f}`, import.meta.url), "utf8"),
  );
const p = validatePuzzle(json("sample_puzzle.json"));
const answer = json("sample_solution.PRIVATE.json").placements as Placement[];
const attempt = (extra: Partial<Attempt> = {}): Attempt => ({
  record_version: 1,
  run_id: "test",
  puzzle_id: p.puzzle_id,
  puzzle_hash: "hash",
  rules_version: p.rules_version,
  mode: "first",
  state: "completed",
  placements: answer,
  active_elapsed_ms: 60000,
  interrupted: false,
  clock_status: "continuous",
  hint_count: 0,
  timer_visible: true,
  started_at_client: new Date().toISOString(),
  finished_at_client: new Date().toISOString(),
  ...extra,
});
describe("geometry and runtime validation", () => {
  it("rotation identities and symmetric deduplication", () => {
    for (const q of p.pieces)
      expect(rotate(q.cells, 4)).toEqual(rotate(q.cells, 0));
    expect(
      orientations(p.pieces.find((q) => q.id === "D")!.cells),
    ).toHaveLength(2);
  });
  it("rejects malformed contract, disconnected shapes, duplicates, floats and reflection", () => {
    const changes = [
      (v: any) => (v.board.blocked[0] = [5, 0]),
      (v: any) => (v.pieces[0].cells[0] = v.pieces[0].cells[1]),
      (v: any) => (v.pieces[0].cells[0] = [9, 9]),
      (v: any) => (v.rules.allow_reflection = true),
      (v: any) => (v.pieces[0].cells[0] = [0.1, 0]),
      (v: any) => (v.pieces[0].initial_rotation = 4),
      (v: any) => (v.seed = "secret"),
      (v: any) => (v.pieces[1].cells = v.pieces[0].cells),
    ];
    for (const change of changes) {
      const q = structuredClone(p);
      change(q);
      expect(() => validatePuzzle(q)).toThrow();
    }
  });
  it("recognizes reflected shape equivalence without permitting reflection in play", () => {
    expect(signature(p.pieces[0].cells)).toEqual(
      signature(p.pieces[0].cells.map(([x, y]) => [-x, y])),
    );
  });
  it("accepts complete geometry independent of solution serialization", () => {
    expect(complete(p, [...answer].reverse())).toBe(true);
    expect(complete(p, [...answer, answer[0]])).toBe(false);
    expect(complete(p, answer.slice(1))).toBe(false);
  });
  it("invalid placement leaves the original state intact", () => {
    const initial = answer.slice(0, 1);
    for (const q of [
      { ...answer[0], x: -1 },
      { ...answer[0], rotation: 4 as any },
      { ...answer[0], x: 0.5 },
    ])
      expect(commit(p, initial, q)).toBe(initial);
    expect(
      placementError(p, [], { piece_id: "D", rotation: 0, x: 0, y: 0 }),
    ).toBe("blocked");
    expect(
      placementError(p, answer, { piece_id: "D", rotation: 0, x: 2, y: 0 }),
    ).toBe("overlap");
  });
  it("hash canonicalization matches Python UTF-8 canonical JSON", () => {
    const js = canonical(p),
      py = execFileSync(
        "python3",
        [
          "-c",
          'import json;print(json.dumps(json.load(open("examples/sample_puzzle.json")),sort_keys=True,separators=(",",":"),ensure_ascii=False))',
        ],
        { cwd: new URL("../../", import.meta.url) },
      )
        .toString()
        .trim();
    expect(js).toBe(py);
    expect(createHash("sha256").update(js).digest("hex")).toHaveLength(64);
  });
});
describe("solver independent reference comparison", () => {
  it("agrees with Python exact-cover and independent DFS for all 30 fixtures", () => {
    const batch = json("verified_fixture_batch.json");
    for (const item of batch) {
      const result = solve(validatePuzzle(item.puzzle));
      expect(result.unique).toBe(true);
      expect(complete(item.puzzle, result.solutions[0])).toBe(true);
    }
    const result = execFileSync(
      "python3",
      [
        "-m",
        "unittest",
        "discover",
        "-s",
        "verification",
        "-p",
        "test_reference.py",
      ],
      {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    expect(result).toBe("");
  });
  it("classifies zero, multiple and exhausted budgets independently", () => {
    for (const [f, n] of [
      ["negative_unsolvable.json", 0],
      ["negative_multiple.json", 2],
    ] as const) {
      const neg = json(f);
      neg.purpose = "design_verification_only";
      neg.puzzle_id = "negative-test";
      const result = solve(validatePuzzle(neg));
      expect(result.count).toBe(n);
      expect(result.unique).toBe(false);
    }
    expect(solve(p, 1).aborted).toBe(true);
    expect(solve(p, 1).unique).toBe(false);
  });
  it("hints prioritize wrong piece without deleting it, then lowest unplaced ID", () => {
    const wrong: Placement = { piece_id: "A", rotation: 0, x: 2, y: 0 };
    expect(hint(p, [wrong], answer)?.kind).toBe("remove");
    expect(hint(p, [], answer)?.placement.piece_id).toBe("A");
    expect(hint(p, answer, answer)).toBe(null);
  });
});
describe("attempt integrity and boundaries", () => {
  it.each([
    [59999, true],
    [60000, true],
    [60001, false],
  ])("60-second boundary %d", (ms, ok) =>
    expect(sixtyTag(attempt({ active_elapsed_ms: ms as number }))).toBe(ok),
  );
  it("hints, pauses, uncertain clocks and practice disqualify the tag", () => {
    for (const changes of [
      { hint_count: 1 },
      { interrupted: true },
      { clock_status: "uncertain" as const },
      { mode: "practice" as const },
      { state: "revealed" as const },
    ])
      expect(sixtyTag(attempt(changes))).toBe(false);
  });
  it("rejects broken saves, wrong puzzle hashes and forged completion", () => {
    expect(validateAttempt(attempt(), p, "hash").state).toBe("completed");
    for (const a of [
      attempt({ puzzle_hash: "other" }),
      attempt({ active_elapsed_ms: -1 }),
      attempt({ placements: [] }),
      attempt({ hint_count: -1 }),
      attempt({ run_id: "" }),
      attempt({ finished_at_client: null }),
      attempt({ state: "playing" }),
      attempt({ placements: [answer[0], answer[0]] }),
    ])
      expect(() => validateAttempt(a, p, "hash")).toThrow();
  });
});
