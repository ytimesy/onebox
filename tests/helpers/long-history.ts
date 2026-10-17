// Disposable boundary fixture only. The 180 repeated historical shapes are NOT
// real publications or quality stock. Never import this helper into a CLI.
import { mkdir, writeFile, symlink, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  validatePuzzle,
  type Puzzle,
} from "../../packages/game-core/index.ts";
import {
  dailyEntry,
  validateManifest,
} from "../../packages/game-core/release.ts";
import { DailyRehearsal } from "../../packages/puzzle-tools/daily-rehearsal.ts";
import { digest } from "../../packages/puzzle-tools/generator.ts";
import { replaceHistory } from "../../packages/puzzle-tools/curation.ts";
import { prepareDaily } from "../../packages/puzzle-tools/daily.ts";
import {
  syntheticQualityCatalog,
  reviewSyntheticStock,
} from "./quality-catalog.ts";
export async function longHistoryRehearsal(root: string) {
  const at = "2026-10-16T00:00:01.000Z";
  const c = syntheticQualityCatalog(
    at,
    JSON.parse(
      readFileSync("tests/fixtures/daily-extra.json", "utf8"),
    ) as Puzzle[],
  );
  const source = c.entries[0],
    items = [],
    entries = [],
    payloads: Record<string, string> = {},
    plans: Record<string, string> = {},
    sources: Record<string, string> = {};
  for (let i = 0; i < 180; i++) {
    const day = new Date(
      Date.parse("2026-10-16T00:00:00.000Z") - (179 - i) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const old = structuredClone(source);
    old.puzzle.puzzle_id = `archive-source-${String(i).padStart(3, "0")}`;
    old.verification.hash = digest(old.puzzle);
    old.stage = "rejected";
    old.review = null;
    old.trials = [];
    old.events = [];
    c.entries.push(old);
    const puzzle = validatePuzzle({
        ...old.puzzle,
        puzzle_id: `onebox-${day}`,
        purpose: "production_daily",
      }),
      hash = digest(puzzle),
      entry = dailyEntry(puzzle, hash);
    entries.unshift(entry);
    payloads[hash] = canonical(puzzle);
    plans[puzzle.puzzle_id] = digest({ synthetic_history: i });
    sources[puzzle.puzzle_id] = old.puzzle.puzzle_id;
    items.push({
      sequence: i + 1,
      published_at: `${day}T00:00:01.000Z`,
      puzzle,
      hash,
      solver_nodes: old.verification.nodes,
    });
  }
  replaceHistory(
    c,
    { format_version: 1, total_released: 180, items },
    "test",
    at,
  );
  c.revision++;
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "daily",
    release_status: "ready",
    published_at: at,
    active: entries[0],
    recent: entries,
    recalled_ids: [],
    next_update_at: "2026-10-17T00:00:00.000Z",
  });
  const empty = structuredClone(c);
  empty.history = { format_version: 1, total_released: 0, items: [] };
  empty.history_events = [];
  const store = await DailyRehearsal.initialize(root, empty),
    initial = await store.read();
  const state = {
      ...initial.state,
      catalog: c,
      manifest,
      payloads,
      plans,
      sources,
      parent: initial.hash,
    },
    hash = digest(state),
    pub = join(root, "snapshots", hash, "public");
  await mkdir(join(pub, "puzzles"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(root, "snapshots", hash, "snapshot.PRIVATE.json"),
    canonical(state),
    { mode: 0o600 },
  );
  for (const [h, body] of Object.entries(payloads))
    await writeFile(join(pub, "puzzles", h + ".json"), body);
  await writeFile(join(pub, "release.json"), canonical(manifest));
  await symlink(`snapshots/${hash}`, join(root, "seed-next"));
  await rename(join(root, "seed-next"), join(root, "current"));
  const legacy = await store.read();
  let current = legacy;
  for (const [offset, day] of ["2026-10-17", "2026-10-18"].entries()) {
    const time = `${day}T00:00:01.000Z`,
      reviewed = reviewSyntheticStock(
        structuredClone(current.state.catalog),
        time,
      );
    current = await store.refreshCatalog(
      reviewed,
      time,
      current.hash,
      "test",
      "Explicit synthetic re-review for boundary test only",
    );
    const plan = prepareDaily(
      current.state.catalog,
      c.entries[offset + 1].puzzle.puzzle_id,
      day,
      time,
      current.state.manifest!,
      current.archive,
    );
    current = await store.commit(plan, time, current.hash);
  }
  return { store, legacy, current, oldest: entries.at(-1)! };
}
