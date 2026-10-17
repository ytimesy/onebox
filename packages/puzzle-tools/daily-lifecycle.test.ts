import { afterEach, expect, it } from "vitest";
import { mkdtemp, realpath, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { twoDayRehearsal } from "../../tests/helpers/daily-lifecycle.ts";
import { reviewSyntheticStock } from "../../tests/helpers/quality-catalog.ts";
import { prepareDaily } from "./daily.ts";
import { canonical } from "../game-core/index.ts";
import { inventory } from "./inventory.ts";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "onebox-lifecycle-test-")),
  );
  dirs.push(dir);
  return twoDayRehearsal(join(dir, "state"));
}
it("preserves both published days and records while recalling active/past/all editions and recovering through a new verified day", async () => {
  const { store, first, second, catalog, firstPlan } = await setup();
  expect(second.state.catalog.history.total_released).toBe(2);
  for (const entry of second.state.manifest!.recent)
    expect(
      await readFile(join(second.publicRoot, entry.payload_url), "utf8"),
    ).toBe(second.state.payloads[entry.sha256]);
  const history = canonical(second.state.catalog.history);
  const delayed = await store.markDelayed(
    "2026-10-17T00:00:01.000Z",
    second.hash,
    "test",
    "No accepted next edition",
  );
  expect(delayed.state.manifest!.release_status).toBe("delayed");
  const fallback = await store.recall(
    "onebox-2026-10-16",
    "2026-10-17T00:00:02.000Z",
    delayed.hash,
    "test",
    "Synthetic withdrawal",
  );
  expect(fallback.state.manifest!.active.puzzle_id).toBe("onebox-2026-10-15");
  expect(
    fallback.state.payloads[second.state.manifest!.active.sha256],
  ).toBeUndefined();
  const unavailable = await store.recall(
    "onebox-2026-10-15",
    "2026-10-17T00:00:03.000Z",
    fallback.hash,
    "test",
    "Final synthetic withdrawal",
  );
  expect(unavailable.state.manifest!.release_status).toBe("unavailable");
  expect(await readdir(join(unavailable.publicRoot, "puzzles"))).toEqual([]);
  expect(canonical(unavailable.state.catalog.history)).toBe(history);
  expect(
    (
      await store.recall(
        "onebox-2026-10-15",
        "2026-10-17T00:00:04.000Z",
        fallback.hash,
        "test",
        "Idempotent retry",
      )
    ).unchanged,
  ).toBe(true);
  expect(
    (await store.commit(firstPlan, "2026-10-17T00:00:04.000Z", first.hash))
      .hash,
  ).toBe(unavailable.hash);
  const refreshed = reviewSyntheticStock(
    structuredClone(unavailable.state.catalog),
    "2026-10-17T00:00:05.000Z",
  );
  expect(inventory(refreshed).ready).toBe(30);
  const fresh = await store.refreshCatalog(
    refreshed,
    "2026-10-17T00:00:05.000Z",
    unavailable.hash,
    "test",
    "Synthetic current-context review",
  );
  const plan = prepareDaily(
    fresh.state.catalog,
    catalog.entries[2].puzzle.puzzle_id,
    "2026-10-17",
    "2026-10-17T00:00:06.000Z",
    fresh.state.manifest!,
  );
  const recovered = await store.commit(
    plan,
    "2026-10-17T00:00:06.000Z",
    fresh.hash,
  );
  expect(recovered.state.manifest!.release_status).toBe("ready");
  expect(recovered.state.manifest!.recalled_ids).toEqual([
    "onebox-2026-10-16",
    "onebox-2026-10-15",
  ]);
  expect(recovered.state.catalog.history.total_released).toBe(3);
  expect(Object.keys(recovered.state.payloads)).toEqual([
    plan.manifest.active.sha256,
  ]);
  expect(recovered.state.controls?.map((c) => c.action)).toEqual([
    "refresh_catalog",
    "delayed",
    "recall",
    "recall",
    "refresh_catalog",
  ]);
}, 60000);
it("fails closed on stale heads, failed withdrawal checks and invalid source refresh without altering history", async () => {
  const { store, second } = await setup(),
    history = canonical(second.state.catalog.history);
  await expect(
    store.recall(
      "onebox-2026-10-16",
      "2026-10-17T00:00:01.000Z",
      "f".repeat(64),
      "test",
      "Stale snapshot",
    ),
  ).rejects.toThrow("head changed");
  await expect(
    store.recall(
      "onebox-2026-10-16",
      "2026-10-17T00:00:01.000Z",
      second.hash,
      "test",
      "Check fails",
      async () => {
        throw Error("verification failed");
      },
    ),
  ).rejects.toThrow("verification failed");
  expect((await store.read()).hash).toBe(second.hash);
  await expect(
    store.refreshCatalog(
      second.state.catalog,
      "2026-10-17T00:00:01.000Z",
      second.hash,
      "test",
      "Stale revision",
    ),
  ).rejects.toThrow("advance revision");
  const missing = structuredClone(second.state.catalog);
  missing.revision++;
  missing.entries.pop();
  await expect(
    store.refreshCatalog(
      missing,
      "2026-10-17T00:00:01.000Z",
      second.hash,
      "test",
      "Missing source evidence",
    ),
  ).rejects.toThrow("preserve candidate");
  const reviewed = reviewSyntheticStock(
    structuredClone(second.state.catalog),
    "2026-10-17T00:00:01.000Z",
  );
  await expect(
    store.refreshCatalog(
      reviewed,
      "2026-10-14T00:00:01.000Z",
      second.hash,
      "test",
      "Backdated refresh",
    ),
  ).rejects.toThrow("backwards");
  await expect(
    store.recall(
      "unknown",
      "2026-10-17T00:00:01.000Z",
      second.hash,
      "test",
      "Unknown ID",
    ),
  ).rejects.toThrow();
  await expect(
    store.markDelayed("2026-10-17T00:00:01.000Z", second.hash, "test", ""),
  ).rejects.toThrow("Invalid rehearsal control");
  expect(canonical((await store.read()).state.catalog.history)).toBe(history);
}, 60000);
