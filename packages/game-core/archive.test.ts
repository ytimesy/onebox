import { afterEach, expect, it, vi } from "vitest";
import { canonical, hashPuzzle, validatePuzzle } from "./index.ts";
import {
  dailyEntry,
  validateManifest,
  validatePublishedArchive,
  recallDaily,
  selectPublishedProblem,
  type PublicArchive,
} from "./release.ts";
import {
  cachedArchive,
  cachedPuzzle,
  rememberPublicData,
} from "../../apps/web/src/public-cache.ts";
import { loadArchive } from "../../apps/web/src/public-archive.ts";
import { recheckDailyStart } from "../../apps/web/src/daily-start.ts";
import raw from "../../examples/sample_puzzle.json";
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const puzzles = ["2026-10-18", "2026-01-01"].map((day) =>
    validatePuzzle({
      ...raw,
      puzzle_id: `onebox-${day}`,
      purpose: "production_daily",
    }),
  );
  const entries = await Promise.all(
    puzzles.map(async (p) => dailyEntry(p, await hashPuzzle(p))),
  );
  const archive: PublicArchive = { archive_version: 1, entries },
    bytes = new TextEncoder().encode(canonical(archive)),
    hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "daily",
    release_status: "ready",
    active: entries[0],
    recent: [entries[0]],
    recalled_ids: [],
    published_at: "2026-10-18T00:00:01.000Z",
    next_update_at: "2026-10-19T00:00:00.000Z",
    archive: { sha256: hash, url: `/archives/${hash}.json`, count: 2 },
  });
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  return { puzzles, entries, archive, manifest, data };
}
it("verifies a complete published-only index and rejects hash, identity, private fields, counts, ordering and future editions", async () => {
  const { archive, manifest } = await fixture();
  expect(await validatePublishedArchive(archive, manifest)).toEqual(archive);
  for (const bad of [
    { ...archive, seed: 1 },
    { ...archive, entries: [...archive.entries].reverse() },
    { ...archive, entries: [archive.entries[0], archive.entries[0]] },
    {
      ...archive,
      entries: [
        archive.entries[0],
        {
          ...archive.entries[1],
          sha256: "a".repeat(64),
          payload_url: `/puzzles/${"a".repeat(64)}.json`,
        },
      ],
    },
  ])
    await expect(validatePublishedArchive(bad, manifest)).rejects.toThrow();
  expect(() =>
    validateManifest({
      ...manifest,
      archive: { ...manifest.archive, url: "https://evil.test/archive.json" },
    }),
  ).toThrow();
  expect(() =>
    validateManifest({
      ...manifest,
      archive: { ...manifest.archive, count: 0 },
    }),
  ).toThrow();
});
it("retains archived cached puzzles outside recent and prunes recalls while preserving the immutable index", async () => {
  const { puzzles, entries, archive, manifest } = await fixture();
  rememberPublicData(manifest, puzzles[1], archive);
  expect(await cachedArchive(manifest)).toEqual(archive);
  expect(await cachedPuzzle(entries[1])).toEqual(puzzles[1]);
  const recalled = recallDaily(
    manifest,
    entries[1].puzzle_id,
    "2026-10-18T00:00:02.000Z",
    archive,
  );
  rememberPublicData(recalled);
  expect(await cachedPuzzle(entries[1])).toBeNull();
  expect((await cachedArchive(recalled))?.entries).toHaveLength(2);
  const next = recallDaily(
    recalled,
    entries[0].puzzle_id,
    "2026-10-18T00:00:03.000Z",
    archive,
  );
  expect(next.release_status).toBe("unavailable");
});
it("falls back to the oldest available archived edition when all newer editions are recalled", async () => {
  const { entries, archive, manifest } = await fixture();
  const next = recallDaily(
    manifest,
    entries[0].puzzle_id,
    "2026-10-19T00:00:01.000Z",
    archive,
  );
  expect(next.active).toEqual(entries[1]);
  expect(next.release_status).toBe("delayed");
  expect(selectPublishedProblem(next, "/ja/", "", archive)).toMatchObject({
    entry: entries[1],
  });
});
it("rechecks archived starts, uses verified cache only for transport failures, and blocks malformed/4xx/hash changes", async () => {
  const { puzzles, entries, archive, manifest } = await fixture(),
    loaded = {
      puzzle: puzzles[1],
      entry: entries[1],
      manifest,
      fallback: false,
      archived: true,
      archive,
    };
  rememberPublicData(manifest, puzzles[1], archive);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(url === "/release.json" ? manifest : archive),
        ),
    ),
  );
  expect(
    (await recheckDailyStart(loaded, `/en/p/${entries[1].slug}/`)).fallback,
  ).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url === "/release.json" ? manifest : {}), {
          status: url === "/release.json" ? 200 : 503,
        }),
    ),
  );
  expect(
    (await recheckDailyStart(loaded, `/en/p/${entries[1].slug}/`)).fallback,
  ).toBe(true);
  for (const status of [200, 404]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(url === "/release.json" ? manifest : {}),
            { status: url === "/release.json" ? 200 : status },
          ),
      ),
    );
    await expect(
      recheckDailyStart(loaded, `/ja/p/${entries[1].slug}/`),
    ).rejects.toMatchObject({ code: "invalid" });
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  await expect(loadArchive(manifest)).rejects.toThrow();
});
