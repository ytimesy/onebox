import {
  type Cell,
  type Puzzle,
  normalize,
  orientations,
  canonical,
  validatePuzzle,
} from "../game-core/index.ts";
import { digest } from "./generator.ts";
export const geometryVersion = "onebox-geometry-v1";
const sorted = (cells: Cell[]) =>
  [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const shapeKey = (cells: Cell[]) =>
  orientations(normalize(cells))
    .map((o) => canonical(o.cells))
    .sort()[0];

export function geometryCanonical(puzzle: Puzzle): string {
  validatePuzzle(puzzle);
  const variants: string[] = [];
  for (const mirror of [false, true])
    for (let turns = 0; turns < 4; turns++) {
      const board = ([x, y]: Cell): Cell => {
        if (mirror) x = 4 - x;
        for (let i = 0; i < turns; i++) [x, y] = [4 - y, x];
        return [x, y];
      };
      const shape = ([x, y]: Cell): Cell => {
        if (mirror) x = -x;
        for (let i = 0; i < turns; i++) [x, y] = [-y, x];
        return [x, y];
      };
      // Reflect all pieces together with the board. Reflecting individual pieces
      // independently would wrongly merge puzzles with different handedness.
      const shapes = puzzle.pieces
        .map((p) => shapeKey(p.cells.map(shape)))
        .sort()
        .map((s) => JSON.parse(s));
      variants.push(
        canonical({ blocked: sorted(puzzle.board.blocked.map(board)), shapes }),
      );
    }
  return variants.sort()[0];
}
export const geometryKey = (p: Puzzle) =>
  digest({
    version: geometryVersion,
    geometry: JSON.parse(geometryCanonical(p)),
  });
