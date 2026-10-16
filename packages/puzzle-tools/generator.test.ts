import { it, expect } from "vitest";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  type Puzzle,
  complete,
  connected,
  signature,
} from "../game-core/index.ts";
import { enumerateShapes, generate, verify, digest } from "./generator.ts";

const json = (name: string) =>
  JSON.parse(readFileSync(`examples/${name}`, "utf8"));
const sample = json("sample_puzzle.json");
function negative(name: string): Puzzle {
  // The source negatives deliberately have a non-product purpose.
  // Create explicit solver-only test inputs; never rewrite the supplied files.
  return {
    ...json(name),
    purpose: "design_verification_only",
    puzzle_id: "negative-test",
  };
}
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["packages/puzzle-tools/cli.ts", ...args], {
    encoding: "utf8",
  });

it("enumerates 18 one-sided pentominoes across 12 free shape classes", () => {
  const shapes = enumerateShapes();
  expect(shapes).toHaveLength(18);
  expect(new Set(shapes.map(signature)).size).toBe(12);
  expect(shapes.every((s) => s.length === 5 && connected(s))).toBe(true);
});
it("separates exhaustive uniqueness, no solution, multiple, invalid and unfinished exploration", () => {
  expect(verify(sample).status).toBe("unique");
  expect(verify(negative("negative_unsolvable.json")).status).toBe(
    "unsolvable",
  );
  expect(verify(negative("negative_multiple.json")).status).toBe("multiple");
  expect(verify(json("negative_multiple.json")).status).toBe("invalid");
  const limited = verify(sample, 1);
  expect(limited.status).toBe("unknown");
  expect(limited.aborted).toBe(true);
  expect(limited.solution).toBeNull();
  const partial = verify(sample, verify(sample).nodes - 1);
  expect(partial.count).toBe(1);
  expect(partial.status).toBe("unknown");
  expect(partial.solution).toBeNull();
  expect(verify({ ...sample, seed: 123 }).status).toBe("invalid");
});
it("generates reproducible small private candidates with legal construction and unique solutions", () => {
  const options = { seed: 20261012, count: 5 };
  const a = generate(options),
    b = generate(options);
  expect(a.complete).toBe(true);
  expect(a.candidates).toEqual(b.candidates);
  for (const item of a.candidates) {
    expect(item.puzzle.purpose).toBe("design_verification_only");
    expect(complete(item.puzzle, item.construction)).toBe(true);
    expect(complete(item.puzzle, item.verification.solution!)).toBe(true);
    expect(item.verification.status).toBe("unique");
    expect(item.verification.hash).toBe(digest(item.puzzle));
  }
  const reference = JSON.parse(
    execFileSync("python3", ["verification/check_candidates.py", "-"], {
      input: JSON.stringify(a),
      encoding: "utf8",
    }),
  );
  expect(reference.checked).toBe(5);
  expect(
    reference.reports.every(
      (r: any) => r.exact_cover_count === 1 && r.independent_dfs_count === 1,
    ),
  ).toBe(true);
});
it("compares TypeScript status and canonical hash with both Python solvers on all fixtures and valid-schema negatives", () => {
  const puzzles = [
    ...json("verified_fixture_batch.json").map((x: any) => x.puzzle),
    negative("negative_unsolvable.json"),
    negative("negative_multiple.json"),
  ];
  const reference = JSON.parse(
    execFileSync("python3", ["verification/check_candidates.py", "-"], {
      input: JSON.stringify(puzzles),
      encoding: "utf8",
    }),
  );
  expect(reference.checked).toBe(32);
  for (const [i, puzzle] of puzzles.entries()) {
    const r = verify(puzzle),
      py = reference.reports[i];
    expect(r.aborted).toBe(false);
    expect(r.count).toBe(py.exact_cover_count);
    expect(r.count).toBe(py.independent_dfs_count);
    expect(r.hash).toBe(py.hash);
  }
});
it("never accepts budget-exhausted candidates and enforces a bounded batch", () => {
  const short = generate({ seed: 20261012, count: 10, candidateLimit: 1 });
  expect(short.complete).toBe(false);
  expect(short.draws).toBeLessThanOrEqual(1);
  const limited = generate({
    seed: 20261012,
    count: 1,
    nodeLimit: 1,
    candidateLimit: 200,
  });
  expect(limited.complete).toBe(false);
  expect(limited.candidates).toHaveLength(0);
  expect(limited.rejected.unknown).toBeGreaterThan(0);
  for (const seed of [-1, 4294967296, NaN, 1.5])
    expect(() => generate({ seed })).toThrow();
  expect(() => generate({ seed: 1, count: 30 })).toThrow();
  expect(() => verify(sample, 0)).toThrow();
});
it("runs the native Node CLI with nonzero exit codes for rejection and no answer output", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "onebox-cli-"));
  try {
    const file = resolve(dir, "puzzle.json");
    for (const [puzzle, status, code] of [
      [sample, "unique", 0],
      [negative("negative_unsolvable.json"), "unsolvable", 1],
      [negative("negative_multiple.json"), "multiple", 1],
      [{ ...sample, seed: 42 }, "invalid", 2],
    ] as const) {
      writeFileSync(file, JSON.stringify(puzzle));
      const result = cli("verify", file);
      expect(result.status).toBe(code);
      const report = JSON.parse(result.stdout);
      expect(report.status).toBe(status);
      expect(Object.keys(report)).not.toContain("solution");
    }
    writeFileSync(file, JSON.stringify(sample));
    const limited = cli("verify", file, "--node-limit", "1");
    expect(limited.status).toBe(1);
    expect(JSON.parse(limited.stdout).status).toBe("unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("writes only new private batches, refuses path traversal and public output, and preserves existing files", () => {
  const name = `test-${randomUUID().slice(0, 24)}`;
  const dir = resolve("content/private/candidates", name);
  try {
    const result = cli(
      "generate",
      "--seed",
      "20261012",
      "--batch",
      name,
      "--count",
      "1",
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).accepted).toBe(1);
    const file = resolve(dir, "batch.PRIVATE.json"),
      original = readFileSync(file, "utf8");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(cli("generate", "--seed", "1", "--batch", name).status).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(
      cli("generate", "--seed", "1", "--batch", "../../dist/escape").status,
    ).toBe(2);
    expect(
      cli("generate", "--seed", "1", "--batch", "escape", "--out", "dist")
        .status,
    ).toBe(2);
    expect(
      cli(
        "generate",
        "--seed",
        "1",
        "--batch",
        `${name}-partial`,
        "--count",
        "10",
        "--candidate-limit",
        "1",
      ).status,
    ).toBe(1);
    expect(
      JSON.parse(
        readFileSync(resolve(`${dir}-partial`, "batch.PRIVATE.json"), "utf8"),
      ).complete,
    ).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}-partial`, { recursive: true, force: true });
  }
});
