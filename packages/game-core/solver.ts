import {
  type Puzzle,
  type Placement,
  orientations,
  placementError,
  occupied,
  key,
  validatePuzzle,
} from "./index.ts";
export function solve(p: Puzzle, nodeLimit = 100000, timeLimitMs = 1500) {
  validatePuzzle(p);
  const start = performance.now();
  let nodes = 0,
    aborted = false;
  const solutions: Placement[][] = [];
  const options = p.pieces.map((piece) =>
    orientations(piece.cells)
      .flatMap((o) =>
        Array.from({ length: 25 }, (_, i) => ({
          piece_id: piece.id,
          rotation: o.rotation,
          x: i % 5,
          y: Math.floor(i / 5),
        })).filter((q) => !placementError(p, [], q)),
      )
      .map((q) => ({ q, cells: new Set(occupied(p, q).map(key)) })),
  );
  function dfs(remaining: number[], used: Set<string>, chosen: Placement[]) {
    if (aborted || solutions.length >= 2) return;
    if (++nodes > nodeLimit || performance.now() - start > timeLimitMs) {
      aborted = true;
      return;
    }
    if (!remaining.length) {
      solutions.push(chosen);
      return;
    }
    const legal = remaining
      .map((i) => ({
        i,
        opts: options[i].filter((o) => ![...o.cells].some((k) => used.has(k))),
      }))
      .sort((a, b) => a.opts.length - b.opts.length);
    const best = legal[0];
    for (const o of best.opts)
      dfs(
        remaining.filter((i) => i !== best.i),
        new Set([...used, ...o.cells]),
        [...chosen, o.q],
      );
  }
  dfs([0, 1, 2, 3], new Set(), []);
  return {
    solutions,
    count: solutions.length,
    aborted,
    unique: !aborted && solutions.length === 1,
    nodes,
  };
}
