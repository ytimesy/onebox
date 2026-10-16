import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonical, validatePuzzle } from "../packages/game-core/index.ts";
import { validateManifest } from "../packages/game-core/release.ts";
import { digest } from "../packages/puzzle-tools/generator.ts";
export async function writePlaytestRelease(root) {
  const p = validatePuzzle(
      JSON.parse(await readFile("apps/web/src/playtest.json", "utf8")),
    ),
    hash = digest(p);
  const active = {
    puzzle_id: p.puzzle_id,
    purpose: p.purpose,
    edition_utc: null,
    slug: p.puzzle_id,
    payload_url: `/puzzles/${hash}.json`,
    sha256: hash,
    opens_at: null,
    scheduled_close_at: null,
  };
  const manifest = validateManifest({
    manifest_version: 1,
    stage: "playtest",
    published_at: new Date().toISOString(),
    release_status: "ready",
    active,
    next_update_at: null,
    recent: [active],
    recalled_ids: [],
  });
  await mkdir(`${root}/puzzles`, { recursive: true });
  await writeFile(`${root}${active.payload_url}`, canonical(p), { flag: "wx" });
  await writeFile(`${root}/release.json`, canonical(manifest), { flag: "wx" });
}
