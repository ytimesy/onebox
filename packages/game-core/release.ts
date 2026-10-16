import { canonical, hashPuzzle, validatePuzzle, type Puzzle } from "./index.ts";
import { publicPracticeId } from "./public-route.ts";

export interface PublishedProblem {
  puzzle_id: string;
  purpose: "practice" | "production_daily";
  edition_utc: string | null;
  slug: string;
  payload_url: string;
  sha256: string;
  opens_at: string | null;
  scheduled_close_at: string | null;
}
export interface ReleaseManifest {
  manifest_version: 1;
  stage: "playtest" | "daily";
  published_at: string;
  release_status: "ready" | "delayed";
  active: PublishedProblem;
  next_update_at: string | null;
  recent: PublishedProblem[];
  recalled_ids: string[];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid release record");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !(k in value))
  )
    throw Error("Invalid release fields");
}
export function utcDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("Invalid UTC edition");
  return value;
}
function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw Error("Invalid UTC timestamp");
  return value;
}
export function nextUtcUpdate(now: string) {
  return new Date(
    (Math.floor(Date.parse(timestamp(now)) / 86400000) + 1) * 86400000,
  ).toISOString();
}
function published(value: unknown, stage: string): PublishedProblem {
  const v = object(value);
  fields(v, [
    "puzzle_id",
    "purpose",
    "edition_utc",
    "slug",
    "payload_url",
    "sha256",
    "opens_at",
    "scheduled_close_at",
  ]);
  if (
    typeof v.puzzle_id !== "string" ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(v.puzzle_id) ||
    v.slug !== v.puzzle_id ||
    typeof v.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.sha256) ||
    v.payload_url !== `/puzzles/${v.sha256}.json`
  )
    throw Error("Invalid published identity");
  if (stage === "playtest") {
    if (
      v.puzzle_id !== publicPracticeId ||
      v.purpose !== "practice" ||
      v.edition_utc !== null ||
      v.opens_at !== null ||
      v.scheduled_close_at !== null
    )
      throw Error("Invalid playtest edition");
  } else {
    if (v.purpose !== "production_daily" || typeof v.edition_utc !== "string")
      throw Error("Invalid daily purpose");
    const edition = utcDate(v.edition_utc),
      opens = `${edition}T00:00:00.000Z`;
    if (
      v.puzzle_id !== `onebox-${edition}` ||
      v.opens_at !== opens ||
      v.scheduled_close_at !== nextUtcUpdate(opens)
    )
      throw Error("Invalid daily schedule");
  }
  return v as unknown as PublishedProblem;
}
export function validateManifest(value: unknown): ReleaseManifest {
  const v = object(value);
  fields(v, [
    "manifest_version",
    "stage",
    "published_at",
    "release_status",
    "active",
    "next_update_at",
    "recent",
    "recalled_ids",
  ]);
  if (
    v.manifest_version !== 1 ||
    !["playtest", "daily"].includes(String(v.stage)) ||
    !["ready", "delayed"].includes(String(v.release_status)) ||
    !Array.isArray(v.recent) ||
    v.recent.length > 180 ||
    !Array.isArray(v.recalled_ids) ||
    v.recalled_ids.length > 10000
  )
    throw Error("Invalid manifest");
  const at = timestamp(v.published_at),
    active = published(v.active, String(v.stage));
  const recent = v.recent.map((p) => published(p, String(v.stage)));
  const ids = recent.map((p) => p.puzzle_id);
  if (
    !recent.length ||
    new Set(ids).size !== ids.length ||
    canonical(recent[0]) !== canonical(active) ||
    v.recalled_ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(id),
    ) ||
    new Set(v.recalled_ids).size !== v.recalled_ids.length ||
    v.recalled_ids.includes(active.puzzle_id)
  )
    throw Error("Invalid manifest index");
  if (v.stage === "playtest") {
    if (
      v.next_update_at !== null ||
      v.release_status !== "ready" ||
      recent.length !== 1 ||
      v.recalled_ids.length
    )
      throw Error("Playtest must not promise a daily update");
  } else {
    if (
      v.next_update_at !== nextUtcUpdate(at) ||
      (v.release_status === "ready" &&
        active.edition_utc !== at.slice(0, 10)) ||
      recent.some((p) => Date.parse(p.opens_at!) > Date.parse(at)) ||
      recent.some(
        (p, i) => i > 0 && p.edition_utc! >= recent[i - 1].edition_utc!,
      )
    )
      throw Error("Future or inconsistent daily manifest");
  }
  return structuredClone(v) as unknown as ReleaseManifest;
}
export async function validatePublishedPuzzle(
  value: unknown,
  entry: PublishedProblem,
): Promise<Puzzle> {
  const p = validatePuzzle(value);
  if (
    p.puzzle_id !== entry.puzzle_id ||
    p.purpose !== entry.purpose ||
    (await hashPuzzle(p)) !== entry.sha256
  )
    throw Error("Published puzzle mismatch");
  return p;
}
