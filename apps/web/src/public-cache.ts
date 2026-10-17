import type { Puzzle } from "../../../packages/game-core";
import {
  validateManifest,
  validatePublishedPuzzle,
  validateArchive,
  validatePublishedArchive,
  type PublicArchive,
  type PublishedProblem,
  type ReleaseManifest,
} from "../../../packages/game-core/release";

const key = "onebox:v1:public-cache";
const maxLength = 1100000;
function snapshot() {
  const raw = sessionStorage.getItem(key);
  if (!raw || raw.length > maxLength) throw Error("No usable public cache");
  const value = JSON.parse(raw);
  const manifest = validateManifest(value.manifest);
  if (manifest.stage !== "daily") throw Error("Not a daily cache");
  // Read the previous single-payload format without rewriting saved attempts.
  const oldEntry = manifest.recent.find(
    (p) => p.puzzle_id === value.puzzle?.puzzle_id,
  );
  const puzzles: Record<string, unknown> =
    value.puzzles ?? (oldEntry ? { [oldEntry.sha256]: value.puzzle } : {});
  if (!puzzles || typeof puzzles !== "object" || Array.isArray(puzzles))
    throw Error("Invalid public cache");
  return { manifest, puzzles, archive: value.archive as unknown };
}
export async function cachedArchive(
  manifest: ReleaseManifest,
): Promise<PublicArchive | null> {
  let saved;
  try {
    saved = snapshot();
  } catch {
    return null;
  }
  if (
    !manifest.archive ||
    saved.manifest.archive?.sha256 !== manifest.archive.sha256 ||
    !saved.archive
  )
    return null;
  return validatePublishedArchive(saved.archive, manifest);
}
export function cachedManifest(): ReleaseManifest | null {
  try {
    return snapshot().manifest;
  } catch {
    return null;
  }
}
export async function cachedPuzzle(
  entry: PublishedProblem,
): Promise<Puzzle | null> {
  let saved;
  try {
    saved = snapshot();
  } catch {
    return null;
  }
  if (
    saved.manifest.recalled_ids.includes(entry.puzzle_id) ||
    !Object.hasOwn(saved.puzzles, entry.sha256)
  )
    return null;
  const entries = saved.manifest.recent.some(
    (p) => p.puzzle_id === entry.puzzle_id && p.sha256 === entry.sha256,
  )
    ? saved.manifest.recent
    : ((await cachedArchive(saved.manifest))?.entries ?? []);
  if (
    !entries.some(
      (p) => p.puzzle_id === entry.puzzle_id && p.sha256 === entry.sha256,
    )
  )
    return null;
  // A cached payload is untrusted too. Corruption must block this reuse.
  return validatePublishedPuzzle(saved.puzzles[entry.sha256], entry);
}
export function rememberPublicData(
  manifest: ReleaseManifest,
  puzzle?: Puzzle,
  archive?: PublicArchive,
) {
  try {
    let previous: Record<string, unknown> = {};
    try {
      const saved = snapshot();
      previous = saved.puzzles;
      if (
        !archive &&
        manifest.archive?.sha256 === saved.manifest.archive?.sha256 &&
        saved.archive
      )
        archive = validateArchive(saved.archive, manifest);
    } catch {
      /* Optional cache. */
    }
    if (archive) archive = validateArchive(archive, manifest);
    const puzzles: Record<string, unknown> = {};
    for (const entry of archive?.entries ?? manifest.recent) {
      if (manifest.recalled_ids.includes(entry.puzzle_id)) continue;
      if (Object.hasOwn(previous, entry.sha256))
        puzzles[entry.sha256] = previous[entry.sha256];
      if (puzzle?.puzzle_id === entry.puzzle_id) puzzles[entry.sha256] = puzzle;
    }
    const raw = JSON.stringify({
      manifest,
      puzzles,
      ...(archive ? { archive } : {}),
    });
    if (raw.length <= maxLength) sessionStorage.setItem(key, raw);
    else sessionStorage.removeItem(key);
  } catch {
    /* Storage denial never prevents play. */
  }
}
