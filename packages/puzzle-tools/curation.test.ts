import { it, expect } from "vitest";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  type Cell,
  type Puzzle,
  normalize,
  ids,
  signature,
} from "../game-core/index.ts";
import { generate, digest } from "./generator.ts";
import { geometryKey } from "./geometry.ts";
import {
  type Catalog,
  type Trial,
  type History,
  type Review,
  emptyCatalog,
  validateCatalog,
  validateHistory,
  importBatch,
  startTrial,
  addTrial,
  approve,
  queue,
  reject,
  reopen,
  replaceHistory,
  checkEntry,
  findEntry,
  trialSummary,
  solverBand,
} from "./curation.ts";
import { PrivateStore, privateRoot } from "./private-store.ts";

const p = JSON.parse(
  readFileSync("examples/sample_puzzle.json", "utf8"),
) as Puzzle;
const fixtures = JSON.parse(
  readFileSync("examples/verified_fixture_batch.json", "utf8"),
).map((v: any) => v.puzzle) as Puzzle[];
const at = "2026-10-12T00:00:00.000Z";
function transformed(p: Puzzle, mirror: boolean, turns: number): Puzzle {
  const q = structuredClone(p);
  q.board.blocked = q.board.blocked
    .map(([a, b]) => {
      let x = mirror ? 4 - a : a,
        y = b;
      for (let r = 0; r < turns; r++) [x, y] = [4 - y, x];
      return [x, y] as Cell;
    })
    .reverse();
  q.pieces = q.pieces.map((s) => ({
    ...s,
    cells: normalize(
      s.cells.map(([a, b]) => {
        let x = mirror ? -a : a,
          y = b;
        for (let r = 0; r < turns; r++) [x, y] = [-y, x];
        return [x, y] as Cell;
      }),
    ).reverse(),
  }));
  return q;
}
function renamed(q: Puzzle): Puzzle {
  return {
    ...q,
    puzzle_id: "changed-id",
    purpose: "practice",
    pieces: [...q.pieces].reverse().map((piece, i) => ({
      ...piece,
      id: ids[i],
      initial_rotation: ((piece.initial_rotation + 1) % 4) as 0 | 1 | 2 | 3,
      pattern_id: ["grid", "rings", "dots", "stripes"][i],
    })),
  };
}
function imported(): Catalog {
  const c = emptyCatalog();
  importBatch(
    c,
    generate({ seed: 20261012, count: 3 }),
    "test-batch",
    "test",
    at,
  );
  return c;
}
const trial: Trial = {
  kind: "human_report",
  trial_id: "synthetic-test-only",
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
function review(c: Catalog, id: string): Review {
  const check = checkEntry(c, findEntry(c, id));
  return {
    reviewer: "test",
    notes: "Synthetic test review only",
    accepted_warnings: check.warnings,
    check_hash: check.check_hash,
  };
}
function history(puzzles: Puzzle[], total = puzzles.length): History {
  return {
    format_version: 1,
    total_released: total,
    items: puzzles.map((p, i) => {
      const puzzle = {
        ...structuredClone(p),
        purpose: "production_daily" as const,
        puzzle_id: `history-${total - puzzles.length + i + 1}`,
      };
      return {
        sequence: total - puzzles.length + i + 1,
        published_at: at,
        puzzle,
        hash: digest(puzzle),
        solver_nodes: 18,
      };
    }),
  };
}
it("finds D4 and cosmetic duplicates for all 30 fixtures without changing playable reflection rules", () => {
  for (const fixture of fixtures)
    for (const mirror of [false, true])
      for (let turns = 0; turns < 4; turns++)
        expect(geometryKey(renamed(transformed(fixture, mirror, turns)))).toBe(
          geometryKey(fixture),
        );
});
it("does not identify a single reflected chiral piece or a board-only reflection as the same puzzle", () => {
  const q = structuredClone(p);
  const s = q.pieces.find((s) => {
    const mirror = normalize(s.cells.map(([x, y]) => [-x, y] as Cell));
    // Free signature is identical, but a reflected chiral orientation differs.
    const only = {
      ...q,
      pieces: q.pieces.map((a) => (a === s ? { ...a, cells: mirror } : a)),
    };
    return geometryKey(only) !== geometryKey(q);
  });
  expect(s).toBeDefined();
  s!.cells = normalize(s!.cells.map(([x, y]) => [-x, y] as Cell));
  expect(signature(s!.cells)).toBe(
    signature(p.pieces.find((a) => a.id === s!.id)!.cells),
  );
  expect(geometryKey(q)).not.toBe(geometryKey(p));
  const boardOnly = { ...p, board: transformed(p, true, 0).board };
  expect(geometryKey(boardOnly)).not.toBe(geometryKey(p));
});
it("matches an independent Python geometry oracle on fixtures and transformed cosmetic variants", () => {
  const puzzles = [
    ...fixtures,
    ...Array.from({ length: 8 }, (_, i) =>
      renamed(transformed(p, i >= 4, i % 4)),
    ),
  ];
  const result = JSON.parse(
    execFileSync("python3", ["-E", "verification/check_geometry.py"], {
      input: JSON.stringify(puzzles),
      encoding: "utf8",
    }),
  );
  expect(result).toEqual(puzzles.map(geometryKey));
});
it("checks the full latest 180 history entries and blocks incomplete or mutable history", () => {
  const c = imported(),
    e = c.entries[0];
  const other = fixtures.find((f) => geometryKey(f) !== e.geometry_key)!;
  const h = history(
    [e.puzzle, ...Array.from({ length: 179 }, () => other)],
    181,
  );
  replaceHistory(c, h, "test", at);
  expect(checkEntry(c, e).history_checked).toBe(180);
  expect(checkEntry(c, e).duplicates).toContain("history-2");
  expect(() => startTrial(c, e.puzzle.puzzle_id, "test", at)).toThrow(
    "duplicate",
  );
  expect(() => validateHistory({ ...h, items: h.items.slice(1) })).toThrow(
    "180",
  );
  const tampered = structuredClone(h);
  tampered.items[0].hash = "0".repeat(64);
  expect(() => replaceHistory(c, tampered, "test", at)).toThrow();
  const changed = structuredClone(h);
  changed.items[0].puzzle = changed.items[1].puzzle;
  changed.items[0].hash = digest(changed.items[0].puzzle);
  expect(() => replaceHistory(c, changed, "test", at)).toThrow();
  expect(() => replaceHistory(c, history([]), "test", at)).toThrow("backwards");
});
it("blocks cosmetic duplicates inside a candidate batch until one is rejected", () => {
  const c = imported(),
    original = c.entries[0],
    batch = generate({ seed: 20261012, count: 1 });
  const item = batch.candidates[0];
  item.puzzle.puzzle_id = "cosmetic-duplicate";
  item.verification.hash = digest(item.puzzle);
  importBatch(c, batch, "duplicate-batch", "test", at);
  const copy = c.entries.at(-1)!;
  expect(checkEntry(c, copy).duplicates).toContain(original.puzzle.puzzle_id);
  expect(() => startTrial(c, copy.puzzle.puzzle_id, "test", at)).toThrow(
    "duplicate",
  );
  reject(c, copy.puzzle.puzzle_id, "test", "Reject duplicate", at);
  expect(() =>
    startTrial(c, original.puzzle.puzzle_id, "test", at),
  ).not.toThrow();
});
it("requires trial stages, an actual declared phone completion and an editor review, retaining unfinished starts", () => {
  const c = imported(),
    id = c.entries[0].puzzle.puzzle_id;
  expect(() => addTrial(c, id, trial, "test", at)).toThrow("playtesting");
  expect(() => queue(c, id, "test", at)).toThrow("approval");
  startTrial(c, id, "test", at);
  addTrial(
    c,
    id,
    { ...trial, outcome: "unfinished", hint_count: 1, confusion: "anchor" },
    "test",
    at,
  );
  expect(() => approve(c, id, review(c, id), at)).toThrow("phone completion");
  addTrial(c, id, { ...trial, trial_id: "synthetic-completed" }, "test", at);
  expect(() =>
    addTrial(c, id, { ...trial, kind: "synthetic" }, "test", at),
  ).toThrow();
  expect(() => addTrial(c, id, trial, "test", at)).toThrow("already");
  approve(c, id, review(c, id), at);
  queue(c, id, "test", at);
  expect(findEntry(c, id).stage).toBe("queued");
  expect(trialSummary(findEntry(c, id).trials)).toMatchObject({
    starts: 2,
    completed: 1,
    unfinished: 1,
    used_hint: 1,
    confused: 1,
    completion_median_ms: 60000,
  });
  expect(validateCatalog(c)).toEqual(c);
  expect(
    trialSummary([
      trial,
      {
        ...trial,
        trial_id: "practice-test",
        attempt_mode: "practice",
        active_elapsed_ms: 12000,
      },
    ]),
  ).toMatchObject({
    starts: 2,
    first_starts: 1,
    first_completed: 1,
    first_completion_median_ms: 60000,
    completion_median_ms: 36000,
  });
  reopen(c, id, "test", at);
  expect(findEntry(c, id).review).toBeNull();
  expect(findEntry(c, id).trials).toHaveLength(2);
  expect(findEntry(c, id).events.map((e) => e.action)).toEqual([
    "import",
    "trial-start",
    "trial-report",
    "trial-report",
    "approve",
    "queue",
    "reopen",
  ]);
});
it("reviews repetition warnings and invalidates stale approval after new history or candidates", () => {
  const c = imported(),
    id = c.entries[0].puzzle.puzzle_id;
  const other = fixtures.find(
    (p) => !c.entries.some((e) => e.geometry_key === geometryKey(p)),
  )!;
  const repeated = history([other, other]);
  repeated.items.forEach((h) => {
    h.solver_nodes = c.entries[0].verification.nodes;
  });
  replaceHistory(c, repeated, "test", at);
  startTrial(c, id, "test", at);
  addTrial(c, id, trial, "test", at);
  const current = review(c, id);
  expect(current.accepted_warnings).toContain("repeated_solver_band");
  expect(() =>
    approve(c, id, { ...current, accepted_warnings: [] }, at),
  ).toThrow("warnings");
  approve(c, id, current, at);
  const advanced = history([other, other, other]);
  advanced.items.forEach((h) => {
    h.solver_nodes = c.entries[0].verification.nodes;
  });
  replaceHistory(c, advanced, "test", at);
  expect(() => queue(c, id, "test", at)).toThrow("changed");
  reopen(c, id, "test", at);
  approve(c, id, review(c, id), at);
  queue(c, id, "test", at);
  expect(solverBand(24)).toBe("low");
  expect(solverBand(25)).toBe("medium");
  expect(solverBand(100)).toBe("high");
});
it("rejects tampered source geometry, verification, partial batches and catalog audit", () => {
  const batch = generate({ seed: 20261012, count: 1 });
  const bad = structuredClone(batch);
  bad.candidates[0].construction[0].x = 9;
  expect(() => importBatch(emptyCatalog(), bad, "bad", "test", at)).toThrow();
  expect(() =>
    importBatch(
      emptyCatalog(),
      { ...batch, complete: false },
      "bad",
      "test",
      at,
    ),
  ).toThrow();
  const c = imported();
  c.entries[0].events[0].actor = "forged";
  expect(() => validateCatalog(c)).toThrow("integrity");
});
it("atomically saves private state, retains audit snapshots and refuses competing writers or corrupt state", async () => {
  const name = `test-${randomUUID().slice(0, 24)}`,
    store = new PrivateStore(name);
  try {
    await store.mutate((c) =>
      importBatch(
        c,
        generate({ seed: 20261012, count: 1 }),
        "test",
        "test",
        at,
      ),
    );
    const file = resolve(store.dir, "state.PRIVATE.json"),
      original = readFileSync(file, "utf8");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await store.read()).revision).toBe(1);
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const acquired = new Promise<void>((r) => {
      entered = r;
    });
    const writer = store.mutate(async () => {
      entered();
      await held;
    });
    await acquired;
    await expect(store.mutate(() => undefined)).rejects.toThrow("locked");
    release();
    await writer;
    await expect(
      store.mutate(() => {
        throw Error("reject transaction");
      }),
    ).rejects.toThrow("transaction");
    expect((await store.read()).revision).toBe(2);
    writeFileSync(file, original.replace('"revision": 1', '"revision": 99'));
    await expect(store.read()).rejects.toThrow("integrity");
    unlinkSync(file);
    await expect(store.read()).rejects.toThrow("state missing");
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});
it("runs the CLI on an isolated synthetic workspace and refuses approval without reports, public paths and symlink writes", () => {
  const name = `test-${randomUUID().slice(0, 24)}`,
    dir = resolve(privateRoot, "curation", name),
    batchDir = resolve(privateRoot, "candidates", name),
    temp = mkdtempSync(resolve(tmpdir(), "onebox-curation-"));
  const cli = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["packages/puzzle-tools/curation-cli.ts", ...args, "--workspace", name],
      { encoding: "utf8" },
    );
  try {
    mkdirSync(batchDir, { recursive: true, mode: 0o700 });
    const batch = generate({ seed: 20261012, count: 1 });
    writeFileSync(
      resolve(batchDir, "batch.PRIVATE.json"),
      JSON.stringify(batch),
    );
    expect(cli("import", "--batch", name, "--actor", "test").status).toBe(0);
    const id = batch.candidates[0].puzzle.puzzle_id;
    const historyFile = resolve(temp, "history.json");
    writeFileSync(historyFile, JSON.stringify(history([p])));
    expect(
      cli("import-history", "--file", historyFile, "--actor", "test").status,
    ).toBe(0);
    const wrong = history([p]);
    wrong.items[0].solver_nodes = 999;
    writeFileSync(historyFile, JSON.stringify(wrong));
    expect(
      cli("import-history", "--file", historyFile, "--actor", "test").status,
    ).toBe(2);
    const before = readFileSync(resolve(dir, "state.PRIVATE.json"), "utf8");
    const inspect = cli("inspect", "--id", id);
    expect(inspect.status).toBe(0);
    expect(inspect.stdout).not.toContain('"seed"');
    expect(inspect.stdout).not.toContain('"solution"');
    const report = resolve(temp, "review.json");
    writeFileSync(
      report,
      JSON.stringify({
        reviewer: "test",
        notes: "Not human approval",
        accepted_warnings: [],
        check_hash: JSON.parse(inspect.stdout).check_hash,
      }),
    );
    expect(cli("approve", "--id", id, "--review", report).status).toBe(2);
    expect(readFileSync(resolve(dir, "state.PRIVATE.json"), "utf8")).toBe(
      before,
    );
    expect(cli("start-trial", "--id", id, "--actor", "test").status).toBe(0);
    expect(cli("queue", "--id", id, "--actor", "test").status).toBe(2);
    expect(cli("list").status).toBe(0);
    expect(
      cli("import", "--batch", "../../dist", "--actor", "test").status,
    ).toBe(2);
    expect(
      spawnSync(
        process.execPath,
        [
          "packages/puzzle-tools/curation-cli.ts",
          "list",
          "--workspace",
          "../../dist",
        ],
        { encoding: "utf8" },
      ).status,
    ).toBe(2);
    const linkName = `${name}-link`,
      link = resolve(privateRoot, "curation", linkName);
    symlinkSync(temp, link);
    try {
      expect(
        spawnSync(
          process.execPath,
          [
            "packages/puzzle-tools/curation-cli.ts",
            "import",
            "--batch",
            name,
            "--actor",
            "test",
            "--workspace",
            linkName,
          ],
          { encoding: "utf8" },
        ).status,
      ).toBe(2);
      expect(existsSync(resolve(temp, "state.PRIVATE.json"))).toBe(false);
    } finally {
      unlinkSync(link);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(batchDir, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});
