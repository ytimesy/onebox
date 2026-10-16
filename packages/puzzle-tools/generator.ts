import { createHash } from "node:crypto";
import {
  type Cell,
  type Puzzle,
  type Placement,
  type Piece,
  type Rotation,
  ids,
  key,
  normalize,
  orientations,
  signature,
  connected,
  complete,
  validatePuzzle,
  canonical,
} from "../game-core/index.ts";
import { solve } from "../game-core/solver.ts";

export const versions = {
  generator: "onebox-candidate-v1",
  geometry: "onebox-v1",
  solver: "piece-mrv-v1",
  curation: "unreviewed",
} as const;
export type Status =
  "unique" | "unsolvable" | "multiple" | "unknown" | "invalid";
export interface Verification {
  status: Status;
  count: number;
  aborted: boolean;
  nodes: number;
  hash: string | null;
  solution: Placement[] | null;
}
export function integer(value: number, name: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error(`Invalid ${name}: expected integer ${min}..${max}`);
  return value;
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value), "utf8").digest("hex");
const shapeOrder = (a: Cell[], b: Cell[]) => {
  const sa = JSON.stringify(a),
    sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

export function verify(
  value: unknown,
  nodeLimit = 100000,
  timeLimitMs = 1500,
): Verification {
  integer(nodeLimit, "node limit", 1, 1000000);
  integer(timeLimitMs, "time limit", 1, 5000);
  let puzzle: Puzzle;
  try {
    puzzle = validatePuzzle(value);
  } catch {
    return {
      status: "invalid",
      count: 0,
      aborted: false,
      nodes: 0,
      hash: null,
      solution: null,
    };
  }
  const result = solve(puzzle, nodeLimit, timeLimitMs);
  const status: Status =
    result.count >= 2
      ? "multiple"
      : result.aborted
        ? "unknown"
        : result.unique
          ? "unique"
          : "unsolvable";
  return {
    status,
    count: result.count,
    aborted: result.aborted,
    nodes: result.nodes,
    hash: digest(puzzle),
    solution: result.unique ? result.solutions[0] : null,
  };
}

// One-sided pentominoes: rotations deduplicated, reflections kept distinct.
export function enumerateShapes(): Cell[][] {
  let shapes: Cell[][] = [[[0, 0]]];
  for (let size = 2; size <= 5; size++) {
    const next = new Map<string, Cell[]>();
    for (const shape of shapes)
      for (const [x, y] of shape) {
        for (const c of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ] as Cell[]) {
          if (shape.some((v) => key(v) === key(c))) continue;
          const variants = orientations(normalize([...shape, c]));
          const s = variants.map((v) => v.cells).sort(shapeOrder)[0];
          next.set(JSON.stringify(s), s);
        }
      }
    shapes = [...next.values()].sort(shapeOrder);
  }
  return shapes;
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export interface Candidate {
  puzzle: Puzzle;
  construction: Placement[];
  verification: Verification;
}
export interface BatchOptions {
  seed: number;
  count?: number;
  candidateLimit?: number;
  totalTimeMs?: number;
  nodeLimit?: number;
  solverTimeMs?: number;
}
export function generate(options: BatchOptions) {
  const seed = integer(options.seed, "seed", 0, 4294967295);
  const count = integer(options.count ?? 5, "count", 1, 10);
  const candidateLimit = integer(
    options.candidateLimit ?? 20000,
    "candidate limit",
    1,
    20000,
  );
  const totalTimeMs = integer(
    options.totalTimeMs ?? 15000,
    "total time",
    1,
    15000,
  );
  const nodeLimit = integer(
    options.nodeLimit ?? 100000,
    "node limit",
    1,
    1000000,
  );
  const solverTimeMs = integer(
    options.solverTimeMs ?? 1500,
    "solver time",
    1,
    5000,
  );
  const started = performance.now(),
    rng = random(seed);
  const shapes = enumerateShapes();
  const possible = shapes.map((shape) =>
    orientations(shape).flatMap((o) => {
      const entries: {
        rotation: Rotation;
        x: number;
        y: number;
        cells: Cell[];
      }[] = [];
      for (let x = 0; x < 5 - Math.max(...o.cells.map((c) => c[0])); x++)
        for (let y = 0; y < 5 - Math.max(...o.cells.map((c) => c[1])); y++)
          entries.push({
            rotation: o.rotation,
            x,
            y,
            cells: o.cells.map(([dx, dy]) => [x + dx, y + dy]),
          });
      return entries;
    }),
  );
  const patterns = ["dots", "stripes", "grid", "rings"];
  const candidates: Candidate[] = [],
    seen = new Set<string>();
  const rejected = {
    geometry: 0,
    unsolvable: 0,
    multiple: 0,
    unknown: 0,
    invalid: 0,
    duplicate: 0,
  };
  let draws = 0;
  while (
    candidates.length < count &&
    draws < candidateLimit &&
    performance.now() - started < totalTimeMs
  ) {
    draws++;
    const indices: number[] = [];
    const available = shapes.map((_, i) => i);
    for (let i = 0; i < 4; i++)
      indices.push(
        available.splice(Math.floor(rng() * available.length), 1)[0],
      );
    if (new Set(indices.map((i) => signature(shapes[i]))).size !== 4) {
      rejected.geometry++;
      continue;
    }
    const used = new Set<string>(),
      construction: Placement[] = [];
    for (const [i, s] of indices.entries()) {
      const legal = possible[s].filter((o) =>
        o.cells.every((c) => !used.has(key(c))),
      );
      if (!legal.length) break;
      const q = legal[Math.floor(rng() * legal.length)];
      q.cells.forEach((c) => used.add(key(c)));
      construction.push({
        piece_id: ids[i],
        rotation: q.rotation,
        x: q.x,
        y: q.y,
      });
    }
    const open: Cell[] = [],
      blocked: Cell[] = [];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        (used.has(key([x, y])) ? open : blocked).push([x, y]);
    if (construction.length !== 4 || !connected(open)) {
      rejected.geometry++;
      continue;
    }
    const puzzle: Puzzle = {
      schema_version: 1,
      rules_version: "onebox-v1",
      puzzle_id: "candidate",
      purpose: "design_verification_only",
      board: { width: 5, height: 5, blocked },
      pieces: indices.map((s, i): Piece => ({
        id: ids[i],
        cells: shapes[s],
        initial_rotation: Math.floor(rng() * 4) as Rotation,
        pattern_id: patterns[i],
      })),
      rules: {
        allow_reflection: false,
        target_seconds: 60,
        allow_overtime: true,
      },
    };
    // This literal identity only prevents duplicates inside this small batch.
    // T21 must add board symmetry/name invariance and the 180-day comparison.
    const identity = digest({
      board: puzzle.board,
      pieces: puzzle.pieces.map((p) => p.cells),
    });
    if (seen.has(identity)) {
      rejected.duplicate++;
      continue;
    }
    puzzle.puzzle_id = `candidate-${identity.slice(0, 12)}`;
    if (!complete(validatePuzzle(puzzle), construction))
      throw Error("Invalid construction");
    const remaining = Math.floor(totalTimeMs - (performance.now() - started));
    if (remaining < 1) break;
    const verification = verify(
      puzzle,
      nodeLimit,
      Math.min(solverTimeMs, remaining),
    );
    if (verification.status !== "unique") {
      rejected[verification.status]++;
      continue;
    }
    seen.add(identity);
    candidates.push({ puzzle, construction, verification });
  }
  return {
    format_version: 1,
    status: "candidate-only",
    versions,
    seed,
    requested: count,
    complete: candidates.length === count,
    draws,
    rejected,
    bounds: { candidateLimit, totalTimeMs, nodeLimit, solverTimeMs },
    elapsed_ms: Math.round(performance.now() - started),
    candidates,
  };
}
