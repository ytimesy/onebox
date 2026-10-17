import { afterEach, expect, it } from "vitest";
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { longHistoryRehearsal } from "../../tests/helpers/long-history.ts";
import {
  validatePublishedArchive,
  selectPublishedProblem,
} from "../game-core/release.ts";
import { prepareDaily } from "./daily.ts";
import { reviewSyntheticStock } from "../../tests/helpers/quality-catalog.ts";
const dirs: string[] = [];
afterEach(async () => {
  for (const p of dirs.splice(0)) await rm(p, { recursive: true, force: true });
});
it("upgrades an immutable legacy 180-release snapshot, retains every payload/URL after 182, and withdraws archived editions without erasing history", async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "onebox-archive-test-")),
  );
  dirs.push(dir);
  const { store, legacy, current, oldest } = await longHistoryRehearsal(
      join(dir, "state"),
    ),
    m = current.state.manifest!;
  expect(legacy.state.archive_version).toBeUndefined();
  expect(current.state.archive_version).toBe(1);
  expect(current.state.catalog.history.items).toHaveLength(180);
  expect(current.state.catalog.history.total_released).toBe(182);
  expect(m.recent).toHaveLength(180);
  expect(m.recent.some((e) => e.puzzle_id === oldest.puzzle_id)).toBe(false);
  const archive = await validatePublishedArchive(
    JSON.parse(await readFile(current.publicRoot + m.archive!.url, "utf8")),
    m,
  );
  expect(archive.entries).toHaveLength(182);
  expect(
    selectPublishedProblem(m, `/en/p/${oldest.slug}/`, "?src=share", archive),
  ).toMatchObject({ status: "available", entry: oldest });
  expect(await readFile(current.publicRoot + oldest.payload_url, "utf8")).toBe(
    legacy.state.payloads[oldest.sha256],
  );
  expect(Object.keys(current.state.payloads)).toHaveLength(182);
  const at = "2026-10-19T00:00:01.000Z",
    reviewed = reviewSyntheticStock(structuredClone(current.state.catalog), at);
  expect(() =>
    prepareDaily(
      reviewed,
      reviewed.entries[3].puzzle.puzzle_id,
      "2026-10-19",
      at,
      m,
    ),
  ).toThrow("Complete previous archive");
  expect(() =>
    prepareDaily(
      reviewed,
      reviewed.entries[3].puzzle.puzzle_id,
      "2026-10-19",
      at,
      m,
      archive,
    ),
  ).toThrow("30");
  await expect(
    store.recall(
      oldest.puzzle_id,
      at,
      current.hash,
      "test",
      "Failed archive verification",
      async (pub) => {
        await writeFile(pub + m.archive!.url, "{}");
      },
    ),
  ).rejects.toThrow("archive mismatch");
  expect((await store.read()).hash).toBe(current.hash);
  // Use a different timestamp to retain the failed staged snapshot for inspection.
  const recalled = await store.recall(
    oldest.puzzle_id,
    "2026-10-19T00:00:02.000Z",
    current.hash,
    "test",
    "Synthetic archived withdrawal",
  );
  expect(recalled.state.catalog.history).toEqual(current.state.catalog.history);
  expect(recalled.state.manifest!.active).toEqual(m.active);
  expect(recalled.state.manifest!.archive).toEqual(m.archive);
  expect(recalled.state.payloads[oldest.sha256]).toBeUndefined();
  expect(recalled.archive!.entries).toHaveLength(182);
  expect(
    selectPublishedProblem(
      recalled.state.manifest!,
      `/ja/p/${oldest.slug}/`,
      "",
      recalled.archive,
    ),
  ).toMatchObject({ status: "recalled" });
}, 120000);
