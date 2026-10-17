import { it, expect } from "vitest";
import {
  validateManifest,
  validatePublishedPuzzle,
  nextUtcUpdate,
} from "./release.ts";
import { hashPuzzle, validatePuzzle } from "./index.ts";
import raw from "../../apps/web/src/playtest.json";
const puzzle = validatePuzzle(raw);
async function practice() {
  const hash = await hashPuzzle(puzzle),
    active = {
      puzzle_id: puzzle.puzzle_id,
      purpose: "practice",
      edition_utc: null,
      slug: puzzle.puzzle_id,
      payload_url: `/puzzles/${hash}.json`,
      sha256: hash,
      opens_at: null,
      scheduled_close_at: null,
    };
  return {
    manifest_version: 1,
    stage: "playtest",
    published_at: "2026-10-14T00:00:00.000Z",
    release_status: "ready",
    active,
    next_update_at: null,
    recent: [active],
    recalled_ids: [],
  };
}
it("validates released practice without inventing a date or next update; rejects unknown/private/external data", async () => {
  const manifest = await practice();
  expect(validateManifest(manifest).next_update_at).toBeNull();
  for (const changed of [
    { ...manifest, next_update_at: "2026-10-15T00:00:00.000Z" },
    { ...manifest, seed: 1 },
    {
      ...manifest,
      active: {
        ...manifest.active,
        payload_url: "https://evil.test/puzzle.json",
      },
    },
    { ...manifest, recent: [manifest.active, manifest.active] },
    { ...manifest, recalled_ids: [puzzle.puzzle_id] },
  ])
    expect(() => validateManifest(changed)).toThrow();
});
it("requires matching ID, purpose, schema and canonical hash before starting a published puzzle", async () => {
  const manifest = validateManifest(await practice());
  await expect(
    validatePublishedPuzzle(puzzle, manifest.active),
  ).resolves.toMatchObject({ purpose: "practice" });
  for (const bad of [
    { ...puzzle, puzzle_id: "foreign" },
    { ...puzzle, purpose: "design_verification_only" },
    { ...puzzle, seed: 1 },
    { ...puzzle, rules_version: "unknown" },
    { ...puzzle, pieces: [...puzzle.pieces].reverse() },
  ])
    await expect(
      validatePublishedPuzzle(bad, manifest.active),
    ).rejects.toThrow();
});
it("uses UTC update boundaries and rejects nonexistent calendar dates or future/delayed inconsistencies", () => {
  expect(nextUtcUpdate("2026-10-13T23:59:59.999Z")).toBe(
    "2026-10-14T00:00:00.000Z",
  );
  expect(nextUtcUpdate("2026-10-14T00:00:00.000Z")).toBe(
    "2026-10-15T00:00:00.000Z",
  );
  const hash = "a".repeat(64),
    active = {
      puzzle_id: "onebox-2026-10-14",
      purpose: "production_daily",
      edition_utc: "2026-10-14",
      slug: "onebox-2026-10-14",
      payload_url: `/puzzles/${hash}.json`,
      sha256: hash,
      opens_at: "2026-10-14T00:00:00.000Z",
      scheduled_close_at: "2026-10-15T00:00:00.000Z",
    };
  const manifest = {
    manifest_version: 1,
    stage: "daily",
    published_at: "2026-10-14T00:00:01.000Z",
    release_status: "ready",
    active,
    recent: [active],
    next_update_at: "2026-10-15T00:00:00.000Z",
    recalled_ids: [],
  };
  expect(validateManifest(manifest).stage).toBe("daily");
  expect(() =>
    validateManifest({ ...manifest, published_at: "2026-10-13T23:59:59.999Z" }),
  ).toThrow();
  expect(() =>
    validateManifest({
      ...manifest,
      published_at: "2026-10-15T00:00:00.000Z",
      next_update_at: "2026-10-16T00:00:00.000Z",
    }),
  ).toThrow();
  expect(
    validateManifest({
      ...manifest,
      release_status: "delayed",
      published_at: "2026-10-15T00:00:00.000Z",
      next_update_at: "2026-10-16T00:00:00.000Z",
    }).release_status,
  ).toBe("delayed");
});

it("resolves a fixed slug from the published index and never substitutes active for missing or withdrawn URLs", async () => {
  const { selectPublishedProblem, readPublicJson } =
    await import("./release.ts");
  const manifest = validateManifest(await practice());
  expect(
    selectPublishedProblem(manifest, "/en/p/playtest-fixed-v1/", "?src=share")
      ?.status,
  ).toBe("available");
  expect(selectPublishedProblem(manifest, "/ja/p/missing/")).toBeNull();
  expect(
    selectPublishedProblem(
      manifest,
      "/ja/p/playtest-fixed-v1/",
      "?next=https://invalid.example",
    ),
  ).toBeNull();
  expect(
    selectPublishedProblem(
      { ...manifest, recalled_ids: [manifest.active.puzzle_id] },
      "/ja/p/playtest-fixed-v1/",
    )?.status,
  ).toBe("recalled");
  await expect(
    readPublicJson(new Response('{"ok":true}'), 11),
  ).resolves.toEqual({ ok: true });
  await expect(readPublicJson(new Response('{"ok":true}'), 10)).rejects.toThrow(
    "large",
  );
  await expect(
    readPublicJson(new Response(new Uint8Array([0xff])), 10),
  ).rejects.toThrow();
});

async function dailyControlFixture() {
  const entries = await Promise.all(
    ["2026-10-17", "2026-10-16"].map(async (day) => {
      const p = validatePuzzle({
        ...puzzle,
        puzzle_id: `onebox-${day}`,
        purpose: "production_daily",
      });
      const sha256 = await hashPuzzle(p);
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
  return validateManifest({
    manifest_version: 1,
    stage: "daily",
    published_at: "2026-10-17T00:00:01.000Z",
    release_status: "ready",
    active: entries[0],
    next_update_at: "2026-10-18T00:00:00.000Z",
    recent: entries,
    recalled_ids: [],
  });
}
it("recalls an active edition into a dated delayed fallback and retains other fixed IDs/hashes", async () => {
  const { recallDaily, selectPublishedProblem } = await import("./release");
  const m = await dailyControlFixture(),
    before = JSON.stringify(m);
  const next = recallDaily(m, m.active.puzzle_id, "2026-10-17T00:00:02.000Z");
  expect(next.active).toEqual(m.recent[1]);
  expect(next.release_status).toBe("delayed");
  expect(selectPublishedProblem(next, "/en/p/onebox-2026-10-17/")?.status).toBe(
    "recalled",
  );
  expect(selectPublishedProblem(next, "/ja/p/onebox-2026-10-16/")?.status).toBe(
    "available",
  );
  expect(JSON.stringify(m)).toBe(before);
  expect(
    recallDaily(next, m.active.puzzle_id, "2026-10-17T00:00:03.000Z"),
  ).toEqual(next);
});
it("keeps a valid unavailable tombstone when the final daily puzzle is recalled, without exposing a playable active entry", async () => {
  const { recallDaily, delayDaily, selectPublishedProblem } =
    await import("./release");
  let m = await dailyControlFixture();
  m = recallDaily(m, "onebox-2026-10-17", "2026-10-17T00:00:02.000Z");
  m = recallDaily(m, "onebox-2026-10-16", "2026-10-17T00:00:03.000Z");
  expect(m.release_status).toBe("unavailable");
  expect(selectPublishedProblem(m, "/ja/")?.status).toBe("unavailable");
  expect(selectPublishedProblem(m, "/en/p/onebox-2026-10-16/")?.status).toBe(
    "recalled",
  );
  expect(() => delayDaily(m, "2026-10-17T00:00:04.000Z")).toThrow(
    "No available",
  );
  expect(() => validateManifest({ ...m, release_status: "ready" })).toThrow();
});
it("validates unavailable manifests strictly and forbids them for fixed playtest", async () => {
  const m = await dailyControlFixture();
  expect(() =>
    validateManifest({ ...m, release_status: "unavailable" }),
  ).toThrow();
  expect(() =>
    validateManifest({
      ...m,
      release_status: "unavailable",
      recalled_ids: [m.active.puzzle_id],
    }),
  ).toThrow();
  const fixed = await practice();
  expect(() =>
    validateManifest({ ...fixed, release_status: "unavailable" }),
  ).toThrow();
});
it("marks a delayed edition with the real retained date and rejects unknown IDs/backwards control times", async () => {
  const { delayDaily, recallDaily } = await import("./release");
  const m = await dailyControlFixture(),
    delayed = delayDaily(m, "2026-10-18T00:00:01.000Z");
  expect(delayed.active).toEqual(m.active);
  expect(delayed.release_status).toBe("delayed");
  expect(delayed.next_update_at).toBe("2026-10-19T00:00:00.000Z");
  expect(delayDaily(delayed, "2026-10-18T00:00:02.000Z")).toEqual(delayed);
  expect(() => recallDaily(m, "unknown", "2026-10-17T00:00:02.000Z")).toThrow(
    "Unknown",
  );
  expect(() =>
    recallDaily(m, m.active.puzzle_id, "2026-10-16T00:00:01.000Z"),
  ).toThrow("backwards");
});
