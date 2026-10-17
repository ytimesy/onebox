import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  canonical,
  validatePuzzle,
  hashPuzzle,
} from "../packages/game-core/index.ts";
import {
  validateManifest,
  nextUtcUpdate,
} from "../packages/game-core/release.ts";
import { solve } from "../packages/game-core/solver.ts";

// Synthetic fixtures never enter a publication path or the real curation catalog.
const root = resolve("evidence/daily-preview");
execFileSync("npm", ["run", "typecheck"], { stdio: "inherit" });
execFileSync("npm", ["exec", "--", "vite", "build", "--outDir", root], {
  env: { ...process.env, VITE_STAGE: "daily-preview" },
  stdio: "inherit",
});
const fixtures = JSON.parse(
  await readFile("examples/verified_fixture_batch.json", "utf8"),
);
const entries = [];
for (const [i, day] of ["2026-10-17", "2026-10-16"].entries()) {
  const puzzle = validatePuzzle({
    ...fixtures[i].puzzle,
    puzzle_id: `onebox-${day}`,
    purpose: "production_daily",
  });
  if (!solve(puzzle).unique) throw Error("Simulation fixture is not unique");
  const sha256 = await hashPuzzle(puzzle);
  const entry = {
    puzzle_id: puzzle.puzzle_id,
    purpose: puzzle.purpose,
    edition_utc: day,
    slug: puzzle.puzzle_id,
    payload_url: `/puzzles/${sha256}.json`,
    sha256,
    opens_at: `${day}T00:00:00.000Z`,
    scheduled_close_at: nextUtcUpdate(`${day}T00:00:00.000Z`),
  };
  entries.push(entry);
  await mkdir(`${root}/puzzles`, { recursive: true });
  const payload = canonical(puzzle);
  if (Buffer.byteLength(payload) > 10000) throw Error("Payload budget");
  await writeFile(root + entry.payload_url, payload, { flag: "wx" });
}
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
await writeFile(`${root}/release.json`, canonical(manifest), { flag: "wx" });
const source = await readFile(`${root}/index.html`, "utf8");
for (const locale of ["ja", "en"]) {
  for (const entry of [null, ...entries]) {
    const path = `/${locale}/${entry ? `p/${entry.slug}/` : ""}`;
    const html = source
      .replace('<html lang="ja">', `<html lang="${locale}">`)
      .replace(
        "</head>",
        `<meta name="robots" content="noindex,nofollow"/><link rel="canonical" href="http://127.0.0.1:4327${path}"/></head>`,
      );
    await mkdir(root + path, { recursive: true });
    await writeFile(root + path + "index.html", html);
  }
}
let bytes = 0;
for (const file of await readdir(`${root}/assets`)) {
  if (!/^[\w.-]+\.(js|css)$/.test(file)) throw Error("Unexpected asset");
  const data = await readFile(`${root}/assets/${file}`);
  if (
    /PRIVATE|sample_solution|verified_fixture_batch|BEGIN PRIVATE KEY/.test(
      data.toString(),
    )
  )
    throw Error("Private asset");
  bytes += gzipSync(data).length;
}
if (bytes > 250 * 1024) throw Error("Compressed asset budget");
await writeFile(
  `${root}/.LOCAL_SIMULATION`,
  "ONEBOX synthetic daily preview v1\n",
);
console.log(
  `LOCAL SIMULATION ONLY: ${root}; synthetic 2 editions; gzip ${bytes} bytes. No publish/approval/stock changes.`,
);
