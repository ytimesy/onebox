import { afterEach, expect, it, vi } from "vitest";
import { validatePuzzle, hashPuzzle } from "./index.ts";
import {
  nextUtcUpdate,
  validateManifest,
  recallDaily,
  delayDaily,
} from "./release.ts";
import {
  recheckDailyStart,
  type DailyPublication,
} from "../../apps/web/src/daily-start.ts";
import {
  cachedManifest,
  rememberPublicData,
} from "../../apps/web/src/public-cache.ts";
import raw from "../../examples/sample_puzzle.json";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function fixture() {
  const puzzle = validatePuzzle({
      ...raw,
      puzzle_id: "onebox-2026-10-17",
      purpose: "production_daily",
    }),
    hash = await hashPuzzle(puzzle),
    entry = {
      puzzle_id: puzzle.puzzle_id,
      purpose: "production_daily",
      edition_utc: "2026-10-17",
      slug: puzzle.puzzle_id,
      sha256: hash,
      payload_url: `/puzzles/${hash}.json`,
      opens_at: "2026-10-17T00:00:00.000Z",
      scheduled_close_at: "2026-10-18T00:00:00.000Z",
    },
    manifest = validateManifest({
      manifest_version: 1,
      stage: "daily",
      active: entry,
      recent: [entry],
      recalled_ids: [],
      published_at: "2026-10-17T00:00:01.000Z",
      next_update_at: "2026-10-18T00:00:00.000Z",
      release_status: "ready",
    });
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  const loaded: DailyPublication = {
    puzzle,
    entry: manifest.active,
    manifest,
    fallback: false,
  };
  rememberPublicData(manifest, puzzle);
  return { loaded, data };
}
function respond(body: unknown, status = 200) {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("rechecks the verified edition before new starts and preserves explicit practice provenance", async () => {
  const { loaded } = await fixture(),
    f = respond(loaded.manifest);
  expect(await recheckDailyStart(loaded, "/ja/")).toMatchObject({
    fallback: false,
    updated: false,
    puzzle: loaded.puzzle,
    entry: loaded.entry,
  });
  expect(f).toHaveBeenCalledWith(
    "/release.json",
    expect.objectContaining({
      cache: "no-cache",
      signal: expect.any(AbortSignal),
    }),
  );
  expect(
    (await recheckDailyStart({ ...loaded, fallback: true }, "/ja/")).fallback,
  ).toBe(true);
  const delayed = delayDaily(loaded.manifest, "2026-10-18T00:00:01.000Z");
  respond(delayed);
  expect(
    (await recheckDailyStart(loaded, "/en/")).manifest.release_status,
  ).toBe("delayed");
});
it("marks an outdated top as practice without replacing its puzzle; old fixed URLs remain the same edition", async () => {
  const { loaded } = await fixture(),
    day = "2026-10-18",
    id = `onebox-${day}`,
    next = {
      ...loaded.entry,
      puzzle_id: id,
      slug: id,
      edition_utc: day,
      opens_at: `${day}T00:00:00.000Z`,
      scheduled_close_at: nextUtcUpdate(`${day}T00:00:00.000Z`),
    };
  respond({
    ...loaded.manifest,
    active: next,
    recent: [next, loaded.entry],
    published_at: `${day}T00:00:01.000Z`,
    next_update_at: "2026-10-19T00:00:00.000Z",
  });
  const result = await recheckDailyStart(loaded, "/ja/");
  expect(result.updated).toBe(true);
  expect(result.puzzle).toBe(loaded.puzzle);
  expect(result.entry).toBe(loaded.entry);
  expect(
    (
      await recheckDailyStart(
        loaded,
        `/en/p/${loaded.entry.slug}/`,
        "?src=share",
      )
    ).updated,
  ).toBe(false);
});
it("blocks a newly withdrawn or delisted puzzle and prunes cached data without consuming a first attempt", async () => {
  const { loaded, data } = await fixture(),
    stopped = recallDaily(
      loaded.manifest,
      loaded.entry.puzzle_id,
      "2026-10-17T00:00:02.000Z",
    );
  respond(stopped);
  await expect(recheckDailyStart(loaded, "/ja/")).rejects.toMatchObject({
    code: "withdrawn",
    manifest: stopped,
  });
  expect(cachedManifest()).toEqual(stopped);
  expect(JSON.parse(data.get("onebox:v1:public-cache")!).puzzles).toEqual({});
  const newer = structuredClone(loaded.manifest),
    day = "2026-10-18",
    id = `onebox-${day}`;
  newer.active = {
    ...newer.active,
    puzzle_id: id,
    slug: id,
    edition_utc: day,
    opens_at: `${day}T00:00:00.000Z`,
    scheduled_close_at: "2026-10-19T00:00:00.000Z",
  };
  newer.recent = [newer.active];
  newer.published_at = `${day}T00:00:01.000Z`;
  newer.next_update_at = "2026-10-19T00:00:00.000Z";
  respond(newer);
  await expect(recheckDailyStart(loaded, "/ja/")).rejects.toMatchObject({
    code: "missing",
  });
});
it("rejects manifest rollback, removed recall records and changed content under an existing ID", async () => {
  const { loaded } = await fixture();
  for (const manifest of [
    { ...loaded.manifest, published_at: "2026-10-17T00:00:00.000Z" },
    {
      ...loaded.manifest,
      active: {
        ...loaded.entry,
        sha256: "a".repeat(64),
        payload_url: `/puzzles/${"a".repeat(64)}.json`,
      },
      recent: [
        {
          ...loaded.entry,
          sha256: "a".repeat(64),
          payload_url: `/puzzles/${"a".repeat(64)}.json`,
        },
      ],
    },
  ]) {
    respond(manifest);
    await expect(recheckDailyStart(loaded, "/ja/")).rejects.toMatchObject({
      code: "invalid",
    });
  }
  respond(loaded.manifest);
  await expect(
    recheckDailyStart(
      {
        ...loaded,
        manifest: { ...loaded.manifest, recalled_ids: ["onebox-2026-10-16"] },
      },
      "/ja/",
    ),
  ).rejects.toMatchObject({ code: "invalid" });
  expect(cachedManifest()).toEqual(loaded.manifest);
});
it("allows only practice on transport/5xx failure and never revives a known withdrawn edition offline", async () => {
  const { loaded } = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("offline");
    }),
  );
  expect(await recheckDailyStart(loaded, "/ja/")).toMatchObject({
    fallback: true,
    puzzle: loaded.puzzle,
    entry: loaded.entry,
  });
  respond({}, 503);
  expect((await recheckDailyStart(loaded, "/ja/")).fallback).toBe(true);
  const stopped = recallDaily(
    loaded.manifest,
    loaded.entry.puzzle_id,
    "2026-10-17T00:00:02.000Z",
  );
  await expect(
    recheckDailyStart({ ...loaded, manifest: stopped }, "/ja/"),
  ).rejects.toMatchObject({ code: "withdrawn" });
});
it("blocks 4xx, malformed and oversized responses instead of hiding them with cached data", async () => {
  const { loaded } = await fixture();
  for (const [body, status] of [
    ["{}", 404],
    ["{", 200],
    [" ".repeat(1000001), 200],
    [JSON.stringify({ ...loaded.manifest, stage: "playtest" }), 200],
  ] as const) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status })),
    );
    await expect(recheckDailyStart(loaded, "/ja/")).rejects.toMatchObject({
      code: "invalid",
    });
  }
});
it("cancels verification when its owner clears or leaves instead of starting practice", async () => {
  const { loaded } = await fixture(),
    owner = new AbortController();
  const f = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        options.signal!.addEventListener(
          "abort",
          () => reject(Error("cancelled")),
          { once: true },
        ),
      ),
  );
  vi.stubGlobal("fetch", f);
  const result = recheckDailyStart(loaded, "/ja/", "", owner.signal);
  owner.abort();
  await expect(result).rejects.toThrow("cancelled");
  f.mockClear();
  await expect(
    recheckDailyStart(loaded, "/ja/", "", owner.signal),
  ).rejects.toThrow("cancelled");
  expect(f).not.toHaveBeenCalled();
});
it("bounds a stalled start check to ten seconds and then permits practice on the already verified puzzle", async () => {
  const { loaded } = await fixture();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, o: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          o.signal!.addEventListener("abort", () => reject(Error("timeout")), {
            once: true,
          }),
        ),
    ),
  );
  const result = recheckDailyStart(loaded, "/ja/");
  await vi.advanceTimersByTimeAsync(10000);
  expect((await result).fallback).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
