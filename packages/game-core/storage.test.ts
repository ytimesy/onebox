import { afterEach, it, expect, vi } from "vitest";
import { Store } from "../../apps/web/src/storage";
import { type Attempt, validatePuzzle } from "./index";
import raw from "../../examples/sample_puzzle.json";
const puzzle = validatePuzzle(raw);
const attempt: Attempt = {
  record_version: 1,
  run_id: "first-run",
  puzzle_id: puzzle.puzzle_id,
  puzzle_hash: "hash",
  rules_version: puzzle.rules_version,
  mode: "first",
  state: "playing",
  placements: [],
  active_elapsed_ms: 0,
  interrupted: false,
  clock_status: "continuous",
  hint_count: 0,
  timer_visible: true,
  started_at_client: new Date().toISOString(),
  finished_at_client: null,
};
afterEach(() => vi.unstubAllGlobals());
it("keeps cached continuation private after ownership checks become unavailable", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  const store = new Store();
  store.save(attempt);
  const before = [...data.entries()];
  store.useMemoryOnly();
  const next = { ...attempt, active_elapsed_ms: 1000, hint_count: 1 };
  expect(store.save(next)).toBe(true);
  expect(store.read(puzzle, "hash")).toEqual(next);
  expect([...data.entries()]).toEqual(before);
  expect(store.warning).toBe(true);
});
it("retains the newest in-memory run when quota fails after earlier successful saves", () => {
  const data = new Map<string, string>();
  let fail = false;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail) throw Error("quota");
      data.set(k, v);
    },
    removeItem: (k: string) => data.delete(k),
  });
  const store = new Store();
  store.save(attempt);
  fail = true;
  const next = {
    ...attempt,
    state: "paused" as const,
    hint_count: 2,
    active_elapsed_ms: 2300,
    interrupted: true,
  };
  store.save(next);
  expect(store.read(puzzle, "hash")).toEqual(next);
  expect(store.mode(puzzle)).toBe("practice");
  expect(store.warning).toBe(true);
});
it("terminal first results are immutable and a different first run is rejected", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  const store = new Store();
  const ended = {
    ...attempt,
    state: "abandoned" as const,
    finished_at_client: new Date().toISOString(),
  };
  expect(store.save(ended)).toBe(true);
  expect(store.save({ ...ended, hint_count: 99 })).toBe(true);
  expect(store.read(puzzle, "hash")?.hint_count).toBe(0);
  expect(store.save({ ...attempt, run_id: "forged-first" })).toBe(false);
});

function historyStorage() {
  const data: Record<string, string> = {};
  let fail = false;
  const storage = Object.defineProperties(data, {
    getItem: {
      value: (k: string) => {
        if (fail) throw Error("unavailable");
        return data[k] ?? null;
      },
    },
    setItem: {
      configurable: true,
      value: (k: string, v: string) => {
        if (fail) throw Error("unavailable");
        data[k] = v;
      },
    },
    removeItem: {
      value: (k: string) => {
        delete data[k];
      },
    },
  });
  vi.stubGlobal("localStorage", storage);
  return {
    data,
    fail: () => {
      fail = true;
    },
  };
}
it("rejects an old tab's save after records are cleared and drops cached unsaved results", () => {
  const { data } = historyStorage(),
    old = new Store(),
    clearer = new Store();
  old.save(attempt);
  data["other-app:record"] = "keep";
  clearer.clear();
  expect(old.save({ ...attempt, active_elapsed_ms: 2500 })).toBe(false);
  expect(old.read(puzzle, "hash")).toBeNull();
  expect(old.recent(puzzle, "hash")).toHaveLength(0);
  expect(data["other-app:record"]).toBe("keep");
  expect(
    Object.keys(data).filter((k) => k.startsWith("onebox:v1:run:")),
  ).toHaveLength(0);
});
it("still removes records when a full quota initially prevents writing the reset marker", () => {
  const { data } = historyStorage(),
    store = new Store();
  store.save(attempt);
  let tries = 0;
  // Replace the initial mock to simulate setItem failing until deletions free space.
  vi.stubGlobal(
    "localStorage",
    Object.defineProperties(data, {
      setItem: {
        configurable: true,
        value: (k: string, value: string) => {
          tries++;
          if (tries === 1) throw Error("quota");
          data[k] = value;
        },
      },
    }),
  );
  store.clear();
  expect(data["onebox:v1:run:first-run"]).toBeUndefined();
  expect(data["onebox:v1:clear-generation"]).toBeTruthy();
});
it("lists seven latest validated attempts, preserving unfinished and assisted records across reload", () => {
  const { data } = historyStorage();
  const store = new Store();
  for (let i = 0; i < 10; i++)
    store.save({
      ...attempt,
      run_id: `practice-${i}`,
      mode: "practice",
      started_at_client: new Date(Date.UTC(2026, 9, 12, i)).toISOString(),
      hint_count: i,
      interrupted: i % 2 === 1,
    });
  data["other-app:record"] = "keep";
  const before = JSON.stringify(data);
  const records = new Store().recent(puzzle, "hash");
  expect(records.map((a) => a.run_id)).toEqual(
    [9, 8, 7, 6, 5, 4, 3].map((i) => `practice-${i}`),
  );
  expect(records[0]).toMatchObject({
    state: "playing",
    hint_count: 9,
    interrupted: true,
    mode: "practice",
  });
  expect(JSON.stringify(data)).toBe(before);
});
it("excludes foreign problems, tutorials, wrong hash/key and fake completions without changing storage", () => {
  const { data } = historyStorage();
  const samples = [
    { ...attempt, run_id: "foreign", puzzle_id: "private-candidate" },
    { ...attempt, run_id: "tutorial", mode: "tutorial" },
    { ...attempt, run_id: "wrong-hash", puzzle_hash: "different" },
    {
      ...attempt,
      run_id: "fake",
      state: "completed",
      finished_at_client: new Date().toISOString(),
    },
    { ...attempt, run_id: "terminal", state: "abandoned" },
    { ...attempt, run_id: "mismatch" },
    { ...attempt, run_id: "valid" },
  ];
  samples.forEach((a, i) => {
    data[`onebox:v1:run:${i === 5 ? "wrong-key" : a.run_id}`] =
      JSON.stringify(a);
  });
  data["onebox:v1:run:broken"] = "{";
  const before = JSON.stringify(data),
    store = new Store();
  expect(store.recent(puzzle, "hash").map((a) => a.run_id)).toEqual(["valid"]);
  expect(store.warning).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
});
it("uses unsaved memory history on failure without restoring records deleted in another tab", () => {
  const storage = historyStorage(),
    store = new Store();
  store.save(attempt);
  expect(store.recent(puzzle, "hash")).toHaveLength(1);
  delete storage.data["onebox:v1:run:first-run"];
  expect(store.recent(puzzle, "hash")).toHaveLength(0);
  storage.fail();
  expect(store.recent(puzzle, "hash")).toHaveLength(0);
  store.save({
    ...attempt,
    run_id: "memory-practice",
    mode: "practice",
    timer_visible: false,
    clock_status: "uncertain",
  });
  expect(
    store.recent(puzzle, "hash").find((a) => a.run_id === "memory-practice"),
  ).toMatchObject({ timer_visible: false, clock_status: "uncertain" });
  expect(store.warning).toBe(true);
  store.useMemoryOnly();
  const before = JSON.stringify(storage.data);
  store.save({ ...attempt, run_id: "isolated", mode: "practice" });
  expect(
    store.recent(puzzle, "hash").some((a) => a.run_id === "isolated"),
  ).toBe(true);
  expect(JSON.stringify(storage.data)).toBe(before);
});
