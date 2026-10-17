import { afterEach, expect, it, vi } from "vitest";
import {
  cachedManifest,
  cachedPuzzle,
  rememberPublicData,
} from "../../apps/web/src/public-cache";
import { hashPuzzle, validatePuzzle } from "./index";
import {
  nextUtcUpdate,
  validateManifest,
  type PublishedProblem,
} from "./release";
import raw from "../../examples/sample_puzzle.json";
const key = "onebox:v1:public-cache";
export async function dailyFixtures() {
  const puzzles = ["2026-10-17", "2026-10-16"].map((day) =>
    validatePuzzle({
      ...raw,
      puzzle_id: `onebox-${day}`,
      purpose: "production_daily",
    }),
  );
  const entries: PublishedProblem[] = await Promise.all(
    puzzles.map(async (p) => {
      const day = p.puzzle_id.slice(7),
        sha256 = await hashPuzzle(p);
      return {
        puzzle_id: p.puzzle_id,
        purpose: "production_daily",
        edition_utc: day,
        slug: p.puzzle_id,
        sha256,
        payload_url: `/puzzles/${sha256}.json`,
        opens_at: `${day}T00:00:00.000Z`,
        scheduled_close_at: nextUtcUpdate(`${day}T00:00:00.000Z`),
      };
    }),
  );
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "daily",
    published_at: "2026-10-17T00:00:01.000Z",
    release_status: "ready",
    active: entries[0],
    next_update_at: "2026-10-18T00:00:00.000Z",
    recent: entries,
    recalled_ids: [],
  });
  return { puzzles, entries, manifest };
}
function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  return data;
}
afterEach(() => vi.unstubAllGlobals());
it("retains both visited editions, and a missing puzzle never substitutes the active one", async () => {
  storage();
  const { manifest, puzzles, entries } = await dailyFixtures();
  rememberPublicData(manifest, puzzles[0]);
  expect(await cachedPuzzle(entries[1])).toBeNull();
  rememberPublicData(manifest, puzzles[1]);
  expect(cachedManifest()).toEqual(manifest);
  expect(await cachedPuzzle(entries[0])).toEqual(puzzles[0]);
  expect(await cachedPuzzle(entries[1])).toEqual(puzzles[1]);
});
it("reads old single-payload caches including past fixed URLs", async () => {
  const data = storage();
  const { manifest, puzzles, entries } = await dailyFixtures();
  data.set(key, JSON.stringify({ manifest, puzzle: puzzles[1] }));
  expect(await cachedPuzzle(entries[1])).toEqual(puzzles[1]);
  expect(await cachedPuzzle(entries[0])).toBeNull();
});
it("prunes recalled/unlisted payloads when a new manifest is received", async () => {
  const data = storage();
  const { manifest, puzzles, entries } = await dailyFixtures();
  rememberPublicData(manifest, puzzles[1]);
  rememberPublicData({ ...manifest, recalled_ids: [entries[1].puzzle_id] });
  expect(await cachedPuzzle(entries[1])).toBeNull();
  expect(JSON.parse(data.get(key)!).puzzles).toEqual({});
  rememberPublicData(manifest, puzzles[1]);
  rememberPublicData({ ...manifest, recent: [entries[0]] });
  expect(await cachedPuzzle(entries[1])).toBeNull();
});
it("rejects corrupted cached hashes and future manifests", async () => {
  const data = storage();
  const { manifest, puzzles, entries } = await dailyFixtures();
  rememberPublicData(manifest, puzzles[1]);
  const value = JSON.parse(data.get(key)!);
  value.puzzles[entries[1].sha256].pieces[0].initial_rotation = 1;
  data.set(key, JSON.stringify(value));
  await expect(cachedPuzzle(entries[1])).rejects.toThrow();
  value.manifest.published_at = "2026-10-15T00:00:01.000Z";
  data.set(key, JSON.stringify(value));
  expect(cachedManifest()).toBeNull();
});
it("treats unavailable, oversized and malformed cache storage as optional", async () => {
  const data = storage();
  const { manifest, puzzles, entries } = await dailyFixtures();
  for (const raw of [
    "{",
    " ".repeat(1100001),
    JSON.stringify({ manifest, puzzles: [] }),
  ]) {
    data.set(key, raw);
    expect(cachedManifest()).toBeNull();
    expect(await cachedPuzzle(entries[0])).toBeNull();
  }
  vi.stubGlobal("sessionStorage", {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  });
  expect(() => rememberPublicData(manifest, puzzles[0])).not.toThrow();
  expect(cachedManifest()).toBeNull();
});
it("removes all playable payloads when every daily edition has been withdrawn", async () => {
  const data = storage(),
    { manifest, puzzles, entries } = await dailyFixtures();
  rememberPublicData(manifest, puzzles[0]);
  rememberPublicData(manifest, puzzles[1]);
  const { recallDaily } = await import("./release");
  let withdrawn = recallDaily(
    manifest,
    entries[0].puzzle_id,
    "2026-10-17T00:00:02.000Z",
  );
  withdrawn = recallDaily(
    withdrawn,
    entries[1].puzzle_id,
    "2026-10-17T00:00:03.000Z",
  );
  rememberPublicData(withdrawn);
  expect(cachedManifest()?.release_status).toBe("unavailable");
  expect(JSON.parse(data.get(key)!).puzzles).toEqual({});
  for (const entry of entries) expect(await cachedPuzzle(entry)).toBeNull();
});
