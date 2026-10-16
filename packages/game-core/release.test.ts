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
