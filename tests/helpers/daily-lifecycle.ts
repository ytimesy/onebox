// Disposable synthetic editorial actions only. Never import into an operator CLI.
import { readFileSync } from "node:fs";
import {
  syntheticQualityCatalog,
  reviewSyntheticStock,
} from "./quality-catalog.ts";
import { DailyRehearsal } from "../../packages/puzzle-tools/daily-rehearsal.ts";
import { prepareDaily } from "../../packages/puzzle-tools/daily.ts";
import type { Puzzle } from "../../packages/game-core/index.ts";
export async function twoDayRehearsal(
  root: string,
  verify?: (pub: string) => Promise<void>,
) {
  const at = "2026-10-15T00:00:01.000Z";
  const extras = JSON.parse(
    readFileSync("tests/fixtures/daily-extra.json", "utf8"),
  ) as Puzzle[];
  const catalog = syntheticQualityCatalog(at, extras);
  const store = await DailyRehearsal.initialize(root, catalog),
    initial = await store.read();
  const firstPlan = prepareDaily(
    catalog,
    catalog.entries[0].puzzle.puzzle_id,
    "2026-10-15",
    at,
  );
  const first = await store.commit(firstPlan, at, initial.hash);
  const refreshed = reviewSyntheticStock(
    structuredClone(first.state.catalog),
    "2026-10-16T00:00:01.000Z",
  );
  const fresh = await store.refreshCatalog(
    refreshed,
    "2026-10-16T00:00:01.000Z",
    first.hash,
    "test",
    "Synthetic editorial re-review, never main",
  );
  const secondPlan = prepareDaily(
    fresh.state.catalog,
    catalog.entries[1].puzzle.puzzle_id,
    "2026-10-16",
    "2026-10-16T00:00:01.000Z",
    fresh.state.manifest!,
  );
  const second = await store.commit(
    secondPlan,
    "2026-10-16T00:00:01.000Z",
    fresh.hash,
    verify,
  );
  return { store, catalog, first, second, firstPlan, secondPlan };
}
