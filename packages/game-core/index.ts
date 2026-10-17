export type Cell = [number, number];
export type PieceId = "A" | "B" | "C" | "D";
export type Rotation = 0 | 1 | 2 | 3;
export interface Piece {
  id: PieceId;
  cells: Cell[];
  initial_rotation: Rotation;
  pattern_id: string;
}
export interface Puzzle {
  schema_version: 1;
  rules_version: "onebox-v1";
  puzzle_id: string;
  purpose: "production_daily" | "practice" | "design_verification_only";
  board: { width: 5; height: 5; blocked: Cell[] };
  pieces: Piece[];
  rules: { allow_reflection: false; target_seconds: 60; allow_overtime: true };
}
export interface Placement {
  piece_id: PieceId;
  rotation: Rotation;
  x: number;
  y: number;
}
export interface Attempt {
  record_version: 1;
  run_id: string;
  puzzle_id: string;
  puzzle_hash: string;
  rules_version: string;
  mode: "first" | "practice" | "tutorial";
  state: "playing" | "paused" | "completed" | "revealed" | "abandoned";
  placements: Placement[];
  active_elapsed_ms: number;
  interrupted: boolean;
  clock_status: "continuous" | "resumed" | "uncertain";
  hint_count: number;
  timer_visible: boolean;
  started_at_client: string;
  finished_at_client: string | null;
  // Optional additive v1 field: older records remain readable.
  undo_history?: Placement[][];
}
export const ids: PieceId[] = ["A", "B", "C", "D"];
export const key = ([x, y]: Cell) => `${x},${y}`;
export function normalize(cells: Cell[]): Cell[] {
  const mx = Math.min(...cells.map((c) => c[0])),
    my = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([x, y]) => [x - mx, y - my] as Cell)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export function rotate(cells: Cell[], r: number): Cell[] {
  let s = normalize(cells);
  for (let i = 0; i < r; i++) s = normalize(s.map(([x, y]) => [-y, x]));
  return s;
}
export function orientations(cells: Cell[]) {
  const seen = new Set<string>();
  return [0, 1, 2, 3].flatMap((r) => {
    const s = rotate(cells, r),
      k = JSON.stringify(s);
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ rotation: r as Rotation, cells: s }];
  });
}
export function signature(cells: Cell[]) {
  return [
    ...orientations(cells),
    ...orientations(cells.map(([x, y]) => [-x, y])),
  ]
    .map((v) => JSON.stringify(v.cells))
    .sort()[0];
}
export function connected(cells: Cell[]): boolean {
  const pending = new Set(cells.map(key)),
    first = cells[0];
  if (!first) return false;
  pending.delete(key(first));
  const stack = [first];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const c of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as Cell[])
      if (pending.delete(key(c))) stack.push(c);
  }
  return !pending.size;
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function fields(v: Record<string, unknown>, allowed: string[]) {
  if (
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    allowed.some((k) => !(k in v))
  )
    throw Error("Unexpected fields");
}
function cells(v: unknown, n: number): v is Cell[] {
  return (
    Array.isArray(v) &&
    v.length === n &&
    v.every(
      (c) =>
        Array.isArray(c) && c.length === 2 && c.every(Number.isSafeInteger),
    ) &&
    new Set(v.map((c) => key(c))).size === n
  );
}
export function validatePuzzle(v: unknown): Puzzle {
  if (!object(v)) throw Error("Invalid puzzle");
  fields(v, [
    "schema_version",
    "rules_version",
    "puzzle_id",
    "purpose",
    "board",
    "pieces",
    "rules",
  ]);
  if (
    v.schema_version !== 1 ||
    v.rules_version !== "onebox-v1" ||
    typeof v.puzzle_id !== "string" ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(v.puzzle_id) ||
    !["production_daily", "practice", "design_verification_only"].includes(
      String(v.purpose),
    )
  )
    throw Error("Invalid version or ID");
  const b = v.board;
  if (!object(b)) throw Error("Invalid board");
  fields(b, ["width", "height", "blocked"]);
  if (
    b.width !== 5 ||
    b.height !== 5 ||
    !cells(b.blocked, 5) ||
    b.blocked.some(([x, y]) => x < 0 || y < 0 || x > 4 || y > 4)
  )
    throw Error("Invalid blocked cells");
  const open = Array.from(
    { length: 25 },
    (_, i) => [i % 5, Math.floor(i / 5)] as Cell,
  ).filter((c) => !(b.blocked as Cell[]).some((q) => key(q) === key(c)));
  if (!connected(open)) throw Error("Disconnected board");
  if (!Array.isArray(v.pieces) || v.pieces.length !== 4)
    throw Error("Four pieces required");
  const names = new Set(),
    shapes = new Set();
  for (const p of v.pieces) {
    if (!object(p)) throw Error("Invalid piece");
    fields(p, ["id", "cells", "initial_rotation", "pattern_id"]);
    if (
      !ids.includes(p.id as PieceId) ||
      names.has(p.id) ||
      !cells(p.cells, 5) ||
      !connected(p.cells) ||
      Math.min(...p.cells.map((c) => c[0])) !== 0 ||
      Math.min(...p.cells.map((c) => c[1])) !== 0 ||
      !Number.isInteger(p.initial_rotation) ||
      Number(p.initial_rotation) < 0 ||
      Number(p.initial_rotation) > 3 ||
      !["dots", "stripes", "grid", "rings"].includes(String(p.pattern_id))
    )
      throw Error("Invalid shape");
    const s = signature(p.cells);
    if (shapes.has(s)) throw Error("Duplicate shapes");
    shapes.add(s);
    names.add(p.id);
  }
  const r = v.rules;
  if (!object(r)) throw Error("Invalid rules");
  fields(r, ["allow_reflection", "target_seconds", "allow_overtime"]);
  if (
    r.allow_reflection !== false ||
    r.target_seconds !== 60 ||
    r.allow_overtime !== true
  )
    throw Error("Invalid rules");
  return v as unknown as Puzzle;
}
export function occupied(p: Puzzle, q: Placement): Cell[] {
  const piece = p.pieces.find((v) => v.id === q.piece_id);
  return piece
    ? rotate(piece.cells, q.rotation).map(([x, y]) => [x + q.x, y + q.y])
    : [];
}
export function placementError(
  p: Puzzle,
  all: Placement[],
  q: Placement,
): "outside" | "blocked" | "overlap" | "invalid" | null {
  if (
    !ids.includes(q.piece_id) ||
    !Number.isInteger(q.rotation) ||
    q.rotation < 0 ||
    q.rotation > 3 ||
    !Number.isSafeInteger(q.x) ||
    !Number.isSafeInteger(q.y)
  )
    return "invalid";
  const oc = occupied(p, q);
  if (oc.length !== 5) return "invalid";
  if (oc.some(([x, y]) => x < 0 || y < 0 || x >= 5 || y >= 5)) return "outside";
  const block = new Set(p.board.blocked.map(key));
  if (oc.some((c) => block.has(key(c)))) return "blocked";
  const used = new Set(
    all
      .filter((v) => v.piece_id !== q.piece_id)
      .flatMap((v) => occupied(p, v))
      .map(key),
  );
  return oc.some((c) => used.has(key(c))) ? "overlap" : null;
}
export function validPlacements(p: Puzzle, all: Placement[]): boolean {
  return (
    Array.isArray(all) &&
    all.length <= 4 &&
    new Set(all.map((q) => q?.piece_id)).size === all.length &&
    all.every((q) => !!q && !placementError(p, all, q))
  );
}
export function complete(p: Puzzle, all: Placement[]): boolean {
  return (
    all.length === 4 &&
    validPlacements(p, all) &&
    new Set(all.flatMap((q) => occupied(p, q)).map(key)).size === 20
  );
}
export function commit(p: Puzzle, all: Placement[], q: Placement) {
  if (placementError(p, all, q)) return all;
  return [...all.filter((v) => v.piece_id !== q.piece_id), q];
}
export function samePlacement(p: Puzzle, a: Placement, b: Placement) {
  return (
    a.piece_id === b.piece_id &&
    occupied(p, a).map(key).sort().join("|") ===
      occupied(p, b).map(key).sort().join("|")
  );
}
export function sixtyTag(a: Attempt) {
  return (
    a.mode === "first" &&
    a.state === "completed" &&
    a.hint_count === 0 &&
    !a.interrupted &&
    a.clock_status === "continuous" &&
    Number.isFinite(a.active_elapsed_ms) &&
    a.active_elapsed_ms >= 0 &&
    a.active_elapsed_ms <= 60000
  );
}
export function secondsText(ms: number) {
  return (Math.ceil(ms / 100) / 10).toFixed(1);
}
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
export async function hashPuzzle(p: Puzzle) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(p)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function hint(
  p: Puzzle,
  all: Placement[],
  solution: Placement[],
): { kind: "remove" | "place"; placement: Placement } | null {
  for (const id of ids) {
    const a = all.find((q) => q.piece_id === id),
      s = solution.find((q) => q.piece_id === id)!;
    if (a && !samePlacement(p, a, s)) return { kind: "remove", placement: a };
  }
  for (const id of ids)
    if (!all.some((q) => q.piece_id === id))
      return {
        kind: "place",
        placement: solution.find((q) => q.piece_id === id)!,
      };
  return null;
}
export function validateAttempt(v: unknown, p: Puzzle, hash: string): Attempt {
  if (
    !object(v) ||
    v.record_version !== 1 ||
    typeof v.run_id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(v.run_id) ||
    v.puzzle_id !== p.puzzle_id ||
    v.puzzle_hash !== hash ||
    v.rules_version !== p.rules_version ||
    !["first", "practice", "tutorial"].includes(String(v.mode)) ||
    !["playing", "paused", "completed", "revealed", "abandoned"].includes(
      String(v.state),
    ) ||
    !Array.isArray(v.placements) ||
    !validPlacements(p, v.placements as Placement[]) ||
    (v.undo_history !== undefined &&
      (!Array.isArray(v.undo_history) ||
        v.undo_history.length > 512 ||
        !v.undo_history.every((all) => validPlacements(p, all)))) ||
    !Number.isFinite(v.active_elapsed_ms) ||
    Number(v.active_elapsed_ms) < 0 ||
    !Number.isSafeInteger(v.hint_count) ||
    Number(v.hint_count) < 0 ||
    typeof v.interrupted !== "boolean" ||
    typeof v.timer_visible !== "boolean" ||
    !["continuous", "resumed", "uncertain"].includes(String(v.clock_status)) ||
    typeof v.started_at_client !== "string" ||
    !Number.isFinite(Date.parse(v.started_at_client)) ||
    (v.finished_at_client !== null &&
      (typeof v.finished_at_client !== "string" ||
        !Number.isFinite(Date.parse(v.finished_at_client))))
  )
    throw Error("Invalid saved attempt");
  if (v.state === "completed" && !complete(p, v.placements as Placement[]))
    throw Error("Invalid completion");
  if (
    ["completed", "revealed", "abandoned"].includes(String(v.state)) !==
    (v.finished_at_client !== null)
  )
    throw Error("Invalid saved terminal state");
  return v as unknown as Attempt;
}
