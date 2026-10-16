import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { inventory, stockLevel } from "./inventory.ts";
import { generate, digest } from "./generator.ts";
import { PrivateStore } from "./private-store.ts";
import {
  emptyCatalog,
  importBatch,
  startTrial,
  addTrial,
  approve,
  queue,
  reject,
  checkEntry,
  type Trial,
  type Catalog,
} from "./curation.ts";

const at = "2026-10-13T00:00:00.000Z";
const batch = generate({ seed: 20261012, count: 3 });
// Synthetic reports never enter the real catalog.
const trial: Trial = {
  kind: "human_report",
  trial_id: "synthetic-stock-test",
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
function catalog() {
  const c = emptyCatalog();
  importBatch(c, batch, "synthetic-stock-test", "test", at);
  return c;
}
function queued(c: Catalog) {
  const e = c.entries[0],
    id = e.puzzle.puzzle_id;
  startTrial(c, id, "test", at);
  addTrial(c, id, trial, "test", at);
  const check = checkEntry(c, e);
  approve(
    c,
    id,
    {
      reviewer: "test",
      notes: "Synthetic only",
      accepted_warnings: check.warnings,
      check_hash: check.check_hash,
    },
    at,
  );
  queue(c, id, "test", at);
  return e;
}

it("warns below exactly 14 and requires action below exactly 7, independently of target 30", () => {
  for (const [n, level] of [
    [0, "action_required"],
    [6, "action_required"],
    [7, "warning"],
    [13, "warning"],
    [14, "ok"],
    [30, "ok"],
    [31, "ok"],
  ] as const) {
    expect(stockLevel(n)).toEqual({
      level,
      target: 30,
      shortfall: Math.max(0, 30 - n),
    });
  }
  for (const n of [-1, 0.5, NaN, Infinity])
    expect(() => stockLevel(n)).toThrow();
});
it("counts candidates separately, excludes stale queued reviews and never mutates the catalog", () => {
  const c = catalog(),
    e = queued(c),
    before = digest(c);
  expect(inventory(c, at)).toMatchObject({
    counts: { candidate: 2, queued: 1 },
    ready: 1,
    stock: { shortfall: 29 },
  });
  expect(digest(c)).toBe(before);
  // Progress on a different candidate must not invalidate unchanged reviews.
  startTrial(c, c.entries[1].puzzle.puzzle_id, "test", at);
  expect(e.stage).toBe("queued");
  expect(inventory(c, at).ready).toBe(1);
  // Removing a candidate changes the reviewed duplicate context and fails closed.
  reject(c, c.entries[1].puzzle.puzzle_id, "test", "Synthetic removal", at);
  expect(inventory(c, at)).toMatchObject({
    counts: { queued: 1 },
    ready: 0,
    excluded: { stale_review: 1 },
    stock: { level: "action_required" },
  });
});
it("accumulates queued stock through later approvals and reverse queue transitions at the same timestamp", () => {
  const c = catalog();
  for (const e of [...c.entries].reverse()) {
    const id = e.puzzle.puzzle_id;
    startTrial(c, id, "test", at);
    addTrial(c, id, { ...trial, trial_id: `synthetic-${id}` }, "test", at);
    const check = checkEntry(c, e);
    approve(
      c,
      id,
      {
        reviewer: "test",
        notes: "Synthetic only",
        accepted_warnings: check.warnings,
        check_hash: check.check_hash,
      },
      at,
    );
    expect(e.review?.check_hash).toBe(checkEntry(c, e).check_hash);
  }
  for (const e of c.entries) queue(c, e.puzzle.puzzle_id, "test", at);
  expect(inventory(c, at)).toMatchObject({
    ready: 3,
    counts: { queued: 3 },
    excluded: { duplicate: 0, stale_review: 0, machine_verification: 0 },
  });
});
it("excludes geometric duplicates even when a stored queue and review exist; malformed state fails closed", () => {
  const c = catalog(),
    e = queued(c);
  const clone = structuredClone(e);
  clone.puzzle.puzzle_id = "candidate-ffffffffffff";
  clone.verification.hash = digest(clone.puzzle);
  clone.stage = "candidate";
  clone.review = null;
  clone.trials = [];
  c.entries.push(clone);
  expect(inventory(c, at)).toMatchObject({
    ready: 0,
    excluded: { duplicate: 1, stale_review: 0 },
  });
  c.entries[0].verification.hash = "0".repeat(64);
  expect(() => inventory(c, at)).toThrow();
});
it("keeps initial/practice and phone cohorts apart, includes rejected reports and treats no trials as unknown", () => {
  const c = catalog();
  expect(inventory(c, at).trials.first).toMatchObject({
    starts: 0,
    completion_rate: null,
    unfinished_rate: null,
    completion_median_ms: null,
  });
  const id = c.entries[0].puzzle.puzzle_id;
  startTrial(c, id, "test", at);
  for (const t of [
    trial,
    {
      ...trial,
      trial_id: "synthetic-unfinished",
      outcome: "unfinished" as const,
      device: "desktop" as const,
      interrupted: true,
      hint_count: 1,
      confusion: "anchor" as const,
    },
    {
      ...trial,
      trial_id: "synthetic-practice",
      attempt_mode: "practice" as const,
      active_elapsed_ms: 12000,
    },
  ])
    addTrial(c, id, t, "test", at);
  reject(c, id, "test", "Synthetic only", at);
  const r = inventory(c, at);
  expect(r.trials.first).toMatchObject({
    starts: 2,
    completed: 1,
    unfinished: 1,
    completion_rate: 0.5,
    unfinished_rate: 0.5,
    completion_median_ms: 60000,
    used_hint: 1,
    interrupted: 1,
    confused: 1,
  });
  expect(r.trials.practice).toMatchObject({
    starts: 1,
    completed: 1,
    completion_median_ms: 12000,
  });
  expect(r.trials.phone_first).toMatchObject({ starts: 1, completed: 1 });
  expect(r.trials.all).toMatchObject({
    starts: 3,
    completion_median_ms: 36000,
  });
  expect(JSON.stringify(r)).not.toMatch(
    /seed|solution|construction|puzzle_id|trial_id|reviewer|notes/,
  );
});
it("stock CLI reads an isolated workspace without making a revision or leaking payloads", async () => {
  const workspace = "test-stock-" + randomUUID().slice(0, 16),
    store = new PrivateStore(workspace);
  try {
    await store.mutate((c) =>
      importBatch(c, batch, "synthetic-stock-test", "test", at),
    );
    const before = await store.read();
    const raw = execFileSync(
      process.execPath,
      [
        "packages/puzzle-tools/curation-cli.ts",
        "stock",
        "--workspace",
        workspace,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    const r = JSON.parse(raw);
    expect(r).toMatchObject({
      revision: 1,
      counts: { candidate: 3, queued: 0 },
      ready: 0,
      stock: { level: "action_required", shortfall: 30 },
    });
    expect(await store.read()).toEqual(before);
    expect(raw).not.toMatch(
      /seed|solution|construction|puzzle_id|trial_id|reviewer|notes/,
    );
  } finally {
    await rm(store.dir, { recursive: true, force: true });
  }
});
