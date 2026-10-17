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

it("prunes 181 puzzle details while retaining old first-attempt identities", () => {
  const { data } = historyStorage(),
    store = new Store();
  for (let i = 0; i < 181; i++)
    store.save({
      ...attempt,
      run_id: `run-${i}`,
      puzzle_id: `puzzle-${i}`,
      started_at_client: new Date(
        Date.UTC(2026, 0, 1) + i * 1000,
      ).toISOString(),
    });
  expect(
    Object.keys(data).filter((k) => k.startsWith("onebox:v1:current:")),
  ).toHaveLength(180);
  expect(data["onebox:v1:current:puzzle-0"]).toBeUndefined();
  expect(new Store().mode({ ...puzzle, puzzle_id: "puzzle-0" })).toBe(
    "practice",
  );
});
it("keeps distinct corrupt originals and preserves the durable original when quarantine exceeds quota", () => {
  const { data } = historyStorage(),
    store = new Store(),
    current = `onebox:v1:current:${puzzle.puzzle_id}`;
  data[current] = "broken-one";
  expect(store.read(puzzle, "hash")).toBeNull();
  data[current] = "broken-two";
  expect(store.read(puzzle, "hash")).toBeNull();
  expect(
    Object.keys(data)
      .filter((k) => k.startsWith("onebox:v1:quarantine:"))
      .map((k) => data[k]),
  ).toEqual(["broken-one", "broken-two"]);
  data[current] = "last-durable-copy";
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data[k] ?? null,
    setItem: () => {
      throw Error("quota");
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  });
  expect(new Store().read(puzzle, "hash")).toBeNull();
  expect(data[current]).toBe("last-durable-copy");
  expect(store.mode(puzzle)).toBe("practice");
});

it("a quarantined checkpoint cannot reissue a first attempt after reloading", () => {
  const { data } = historyStorage();
  data[`onebox:v1:current:${puzzle.puzzle_id}`] = "{broken";
  expect(new Store().read(puzzle, "hash")).toBeNull();
  expect(new Store().mode(puzzle)).toBe("practice");
});

async function publishedHistory() {
  const { hashPuzzle } = await import("./index");
  const { nextUtcUpdate } = await import("./release");
  const puzzles = ["2026-10-17", "2026-10-16"].map((day) =>
    validatePuzzle({
      ...puzzle,
      puzzle_id: `onebox-${day}`,
      purpose: "production_daily",
    }),
  );
  const entries = await Promise.all(
    puzzles.map(async (p) => {
      const day = p.puzzle_id.slice(7),
        sha256 = await hashPuzzle(p);
      return {
        puzzle_id: p.puzzle_id,
        purpose: "production_daily" as const,
        edition_utc: day,
        slug: p.puzzle_id,
        sha256,
        payload_url: `/puzzles/${sha256}.json`,
        opens_at: `${day}T00:00:00.000Z`,
        scheduled_close_at: nextUtcUpdate(`${day}T00:00:00.000Z`),
      };
    }),
  );
  return { puzzles, entries };
}
it("lists seven validated daily attempts across editions without private/tutorial/fake records or writes", async () => {
  const { data } = historyStorage(),
    { puzzles, entries } = await publishedHistory();
  for (let i = 0; i < 10; i++) {
    const e = entries[i % 2];
    const a = {
      ...attempt,
      run_id: `daily-${i}`,
      puzzle_id: e.puzzle_id,
      puzzle_hash: e.sha256,
      mode: i === 9 ? "first" : "practice",
      state: i === 8 ? "abandoned" : "paused",
      finished_at_client: i === 8 ? new Date().toISOString() : null,
      interrupted: true,
      hint_count: i,
      timer_visible: i !== 7,
      started_at_client: new Date(Date.UTC(2026, 9, 17, 0, i)).toISOString(),
    };
    data[`onebox:v1:run:${a.run_id}`] = JSON.stringify(a);
  }
  data["onebox:v1:run:private"] = JSON.stringify({
    ...attempt,
    run_id: "private",
    puzzle_id: "private-candidate",
  });
  for (const [id, change] of Object.entries({
    tutorial: { mode: "tutorial" },
    hash: { puzzle_hash: "wrong" },
    fake: { state: "completed", finished_at_client: new Date().toISOString() },
    key: { run_id: "different" },
  })) {
    data[`onebox:v1:run:${id}`] = JSON.stringify({
      ...attempt,
      puzzle_id: entries[0].puzzle_id,
      puzzle_hash: entries[0].sha256,
      run_id: id,
      ...change,
    });
  }
  const before = JSON.stringify(data),
    store = new Store(),
    load = vi.fn(async (e) =>
      puzzles.find((p) => p.puzzle_id === e.puzzle_id)!,
    );
  const result = await store.recentPublished(entries, load);
  expect(result.records.map((a) => a.run_id)).toEqual(
    [9, 8, 7, 6, 5, 4, 3].map((i) => `daily-${i}`),
  );
  expect(result.records[0]).toMatchObject({
    mode: "first",
    hint_count: 9,
    interrupted: true,
  });
  expect(result.records[1].state).toBe("abandoned");
  expect(result.records[2].timer_visible).toBe(false);
  expect(result.unavailable).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
  expect(store.warning).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
});
it("keeps unavailable daily records and shows other verified editions without changing first eligibility", async () => {
  const { data } = historyStorage(),
    { puzzles, entries } = await publishedHistory(),
    store = new Store();
  for (const [i, e] of entries.entries())
    data[`onebox:v1:run:daily-${i}`] = JSON.stringify({
      ...attempt,
      run_id: `daily-${i}`,
      puzzle_id: e.puzzle_id,
      puzzle_hash: e.sha256,
    });
  const before = JSON.stringify(data);
  const result = await store.recentPublished(entries, async (e) => {
    if (e.puzzle_id === entries[0].puzzle_id) throw Error("offline");
    return puzzles[1];
  });
  expect(result.records.map((a) => a.run_id)).toEqual(["daily-1"]);
  expect(result.unavailable).toBe(true);
  expect(store.warning).toBe(false);
  expect(store.mode(puzzles[0])).toBe("first");
  expect(JSON.stringify(data)).toBe(before);
});
it("excludes an entry whose loader returned a different puzzle and only loads allowlisted IDs", async () => {
  const { data } = historyStorage(),
    { puzzles, entries } = await publishedHistory(),
    store = new Store();
  data["onebox:v1:run:current"] = JSON.stringify({
    ...attempt,
    run_id: "current",
    puzzle_id: entries[0].puzzle_id,
    puzzle_hash: entries[0].sha256,
  });
  data["onebox:v1:run:recalled"] = JSON.stringify({
    ...attempt,
    run_id: "recalled",
    puzzle_id: entries[1].puzzle_id,
    puzzle_hash: entries[1].sha256,
  });
  const load = vi.fn(async () => puzzles[1]);
  const result = await store.recentPublished([entries[0]], load);
  expect(result.records).toEqual([]);
  expect(result.unavailable).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
});
it("does not revive records deleted while a daily history payload is loading", async () => {
  const { data } = historyStorage(),
    { puzzles, entries } = await publishedHistory(),
    store = new Store();
  data["onebox:v1:run:pending"] = JSON.stringify({
    ...attempt,
    run_id: "pending",
    puzzle_id: entries[0].puzzle_id,
    puzzle_hash: entries[0].sha256,
  });
  const result = await store.recentPublished(entries, async () => {
    new Store().clear();
    return puzzles[0];
  });
  expect(result.records).toEqual([]);
  expect(Object.keys(data).some((k) => k.startsWith("onebox:v1:run:"))).toBe(
    false,
  );
});

it("clearing during a failed history lookup also removes already collected results", async () => {
  const { data } = historyStorage(),
    { puzzles, entries } = await publishedHistory(),
    store = new Store();
  for (const [i, e] of entries.entries())
    data[`onebox:v1:run:lookup-${i}`] = JSON.stringify({
      ...attempt,
      run_id: `lookup-${i}`,
      puzzle_id: e.puzzle_id,
      puzzle_hash: e.sha256,
      started_at_client: `2026-10-17T00:00:0${2 - i}.000Z`,
    });
  const result = await store.recentPublished(entries, async (e) => {
    if (e.puzzle_id === entries[0].puzzle_id) return puzzles[0];
    store.clear();
    throw Error("offline");
  });
  expect(result.records).toEqual([]);
});
