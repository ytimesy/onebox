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
  release_status: "ready" | "delayed" | "unavailable";
  active: PublishedProblem;
  next_update_at: string | null;
  recent: PublishedProblem[];
  recalled_ids: string[];
  archive?: { url: string; sha256: string; count: number };
}
export interface PublicArchive {
  archive_version: 1;
  entries: PublishedProblem[];
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
    ...(Object.hasOwn(v, "archive") ? ["archive"] : []),
  ]);
  if (
    v.manifest_version !== 1 ||
    !["playtest", "daily"].includes(String(v.stage)) ||
    !["ready", "delayed", "unavailable"].includes(String(v.release_status)) ||
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
  const recalled = v.recalled_ids as string[];
  if (
    !recent.length ||
    new Set(ids).size !== ids.length ||
    canonical(recent[0]) !== canonical(active) ||
    v.recalled_ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(id),
    ) ||
    new Set(v.recalled_ids).size !== v.recalled_ids.length ||
    v.recalled_ids.includes(active.puzzle_id) !==
      (v.release_status === "unavailable")
  )
    throw Error("Invalid manifest index");
  if (v.stage === "playtest") {
    if (
      v.next_update_at !== null ||
      v.release_status !== "ready" ||
      recent.length !== 1 ||
      v.recalled_ids.length ||
      v.archive !== undefined
    )
      throw Error("Playtest must not promise a daily update");
  } else {
    if (v.archive !== undefined) {
      const a = object(v.archive);
      fields(a, ["url", "sha256", "count"]);
      if (
        typeof a.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(a.sha256) ||
        a.url !== `/archives/${a.sha256}.json` ||
        !Number.isInteger(a.count) ||
        Number(a.count) < recent.length ||
        Number(a.count) > 10000
      )
        throw Error("Invalid archive reference");
    }
    if (
      (v.release_status === "unavailable" &&
        recent.some((p) => !recalled.includes(p.puzzle_id))) ||
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

export function dailyEntry(puzzle: Puzzle, hash: string): PublishedProblem {
  if (puzzle.purpose !== "production_daily")
    throw Error("Daily puzzle required");
  const day = utcDate(puzzle.puzzle_id.slice(7)),
    opens = `${day}T00:00:00.000Z`;
  return published(
    {
      puzzle_id: puzzle.puzzle_id,
      purpose: puzzle.purpose,
      edition_utc: day,
      slug: puzzle.puzzle_id,
      sha256: hash,
      payload_url: `/puzzles/${hash}.json`,
      opens_at: opens,
      scheduled_close_at: nextUtcUpdate(opens),
    },
    "daily",
  );
}
export function validateArchive(
  value: unknown,
  manifest: ReleaseManifest,
): PublicArchive {
  const v = object(value);
  fields(v, ["archive_version", "entries"]);
  if (
    manifest.stage !== "daily" ||
    v.archive_version !== 1 ||
    !Array.isArray(v.entries) ||
    !v.entries.length ||
    v.entries.length > 10000
  )
    throw Error("Invalid archive");
  const entries = v.entries.map((p) => published(p, "daily")),
    ids = new Set(entries.map((p) => p.puzzle_id));
  if (
    ids.size !== entries.length ||
    (manifest.archive && manifest.archive.count !== entries.length) ||
    entries.some(
      (p, i) =>
        p.opens_at! > manifest.published_at ||
        (i > 0 && p.edition_utc! >= entries[i - 1].edition_utc!),
    ) ||
    manifest.recent.some(
      (p) => !entries.some((e) => canonical(e) === canonical(p)),
    ) ||
    manifest.recalled_ids.some((id) => !ids.has(id)) ||
    (manifest.release_status === "unavailable" &&
      entries.some((p) => !manifest.recalled_ids.includes(p.puzzle_id)))
  )
    throw Error("Inconsistent published archive");
  return structuredClone({ archive_version: 1, entries }) as PublicArchive;
}
export async function validatePublishedArchive(
  value: unknown,
  manifest: ReleaseManifest,
): Promise<PublicArchive> {
  if (!manifest.archive) throw Error("Archive not referenced");
  const archive = validateArchive(value, manifest);
  const bytes = new TextEncoder().encode(canonical(archive));
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== manifest.archive.sha256) throw Error("Archive hash mismatch");
  return archive;
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

export function selectPublishedProblem(
  manifest: ReleaseManifest,
  path: string,
  search = "",
  archive?: PublicArchive,
) {
  if (search && search !== "?src=share") return null;
  if (["/", "/index.html", "/ja/", "/en/"].includes(path)) {
    if (manifest.release_status === "unavailable")
      return { status: "unavailable" as const };
    return { status: "available" as const, entry: manifest.active };
  }
  const match = /^\/(?:ja|en)\/p\/([a-zA-Z0-9-]{1,64})\/$/.exec(path);
  if (!match) return null;
  const slug = match[1];
  if (manifest.recalled_ids.includes(slug))
    return { status: "recalled" as const };
  const entry =
    manifest.recent.find((p) => p.slug === slug) ??
    archive?.entries.find((p) => p.slug === slug);
  return entry ? { status: "available" as const, entry } : null;
}

function controlTime(manifest: ReleaseManifest, at: string) {
  timestamp(at);
  if (manifest.stage !== "daily" || at < manifest.published_at)
    throw Error("Daily control time must not move backwards");
}
export function recallDaily(
  value: ReleaseManifest,
  id: string,
  at: string,
  archive?: PublicArchive,
): ReleaseManifest {
  const manifest = validateManifest(value);
  controlTime(manifest, at);
  if (manifest.recalled_ids.includes(id)) return manifest;
  const published = archive
    ? validateArchive(archive, manifest).entries
    : manifest.recent;
  if (!published.some((p) => p.puzzle_id === id))
    throw Error("Unknown published puzzle");
  const remaining = published.filter(
    (p) => p.puzzle_id !== id && !manifest.recalled_ids.includes(p.puzzle_id),
  );
  const active = remaining[0] ?? manifest.active;
  return validateManifest({
    ...manifest,
    published_at: at,
    release_status: !remaining.length
      ? "unavailable"
      : manifest.release_status === "ready" &&
          active.edition_utc === at.slice(0, 10)
        ? "ready"
        : "delayed",
    active,
    recent: remaining.length ? remaining.slice(0, 180) : [active],
    recalled_ids: [...manifest.recalled_ids, id],
    next_update_at: nextUtcUpdate(at),
  });
}
export function delayDaily(
  value: ReleaseManifest,
  at: string,
): ReleaseManifest {
  const manifest = validateManifest(value);
  controlTime(manifest, at);
  if (manifest.release_status === "unavailable")
    throw Error("No available daily puzzle");
  if (
    manifest.release_status === "delayed" &&
    manifest.published_at.slice(0, 10) === at.slice(0, 10)
  )
    return manifest;
  return validateManifest({
    ...manifest,
    published_at: at,
    release_status: "delayed",
    next_update_at: nextUtcUpdate(at),
  });
}

export async function readPublicJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.ok || !response.body) throw Error("Unavailable public data");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw Error("Public data too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
