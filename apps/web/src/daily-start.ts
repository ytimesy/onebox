import { canonical, type Puzzle } from "../../../packages/game-core/index.ts";
import {
  readPublicJson,
  selectPublishedProblem,
  validateManifest,
  type ReleaseManifest,
  type PublishedProblem,
  type PublicArchive,
} from "../../../packages/game-core/release.ts";
import { rememberPublicData } from "./public-cache";
import { loadArchive, ArchiveNetworkError } from "./public-archive";

export type DailyPublication = {
  puzzle: Puzzle;
  manifest: ReleaseManifest;
  entry: PublishedProblem;
  fallback: boolean;
  updated?: boolean;
  archive?: PublicArchive;
  archived?: boolean;
  denied?: "withdrawn" | "missing";
};
export class DailyStartError extends Error {
  readonly code: "withdrawn" | "missing" | "invalid";
  readonly manifest?: ReleaseManifest;
  constructor(code: DailyStartError["code"], manifest?: ReleaseManifest) {
    super(`Daily start blocked: ${code}`);
    this.code = code;
    this.manifest = manifest;
  }
}

export function assertKnownRecalls(
  current: ReleaseManifest,
  known?: ReleaseManifest | null,
) {
  if (known?.recalled_ids.some((id) => !current.recalled_ids.includes(id)))
    throw new DailyStartError("invalid");
}

// Check only before creating a run. A running/resumed attempt stays pinned and
// never depends on a successful network request or a newly published edition.
export async function recheckDailyStart(
  loaded: DailyPublication,
  path: string,
  search = "",
  signal?: AbortSignal,
): Promise<DailyPublication> {
  const controller = new AbortController(),
    abort = () => controller.abort(),
    deadline = setTimeout(abort, 10000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    if (signal?.aborted) throw Error("Start cancelled");
    if (loaded.denied)
      throw new DailyStartError(loaded.denied, loaded.manifest);
    let response: Response;
    try {
      response = await fetch("/release.json", {
        cache: "no-cache",
        signal: controller.signal,
      });
      if (response.status >= 500) throw Error("Manifest unavailable");
    } catch (e) {
      if (signal?.aborted) throw e;
      const known = selectPublishedProblem(
        loaded.manifest,
        `/ja/p/${loaded.entry.slug}/`,
        "",
        loaded.archive,
      );
      if (known?.status === "recalled")
        throw new DailyStartError("withdrawn", loaded.manifest);
      if (!known || known.status !== "available")
        throw new DailyStartError("missing", loaded.manifest);
      // The loaded puzzle was already verified. An unknown newer state cannot
      // authorize a fresh first attempt, but still permits explicit practice.
      return { ...loaded, fallback: true };
    }
    try {
      const manifest = validateManifest(
        await readPublicJson(response, 1000000),
      );
      if (
        manifest.stage !== "daily" ||
        manifest.published_at < loaded.manifest.published_at
      )
        throw new DailyStartError("invalid");
      assertKnownRecalls(manifest, loaded.manifest);
      let archive: PublicArchive | undefined,
        archiveFallback = false;
      let selected = selectPublishedProblem(
        manifest,
        `/ja/p/${loaded.entry.slug}/`,
      );
      if (!selected && manifest.archive) {
        try {
          const result = await loadArchive(manifest, controller.signal);
          archive = result?.archive;
          archiveFallback = !!result?.fallback;
          selected = selectPublishedProblem(
            manifest,
            `/ja/p/${loaded.entry.slug}/`,
            "",
            archive,
          );
        } catch (e) {
          if (signal?.aborted) throw e;
          if (e instanceof ArchiveNetworkError)
            return { ...loaded, manifest, fallback: true, archived: true };
          throw e;
        }
      }
      if (
        selected?.status === "available" &&
        canonical(selected.entry) !== canonical(loaded.entry)
      )
        throw new DailyStartError("invalid");
      rememberPublicData(manifest, undefined, archive);
      if (selected?.status === "recalled")
        throw new DailyStartError("withdrawn", manifest);
      if (!selected || selected.status !== "available")
        throw new DailyStartError("missing", manifest);
      const routed = selectPublishedProblem(manifest, path, search, archive);
      if (!routed || routed.status !== "available")
        throw new DailyStartError("missing", manifest);
      const updated = routed.entry.puzzle_id !== loaded.entry.puzzle_id;
      rememberPublicData(manifest, loaded.puzzle, archive);
      return {
        ...loaded,
        manifest,
        updated,
        archive,
        archived: !manifest.recent.some(
          (e) => e.puzzle_id === loaded.entry.puzzle_id,
        ),
        fallback: loaded.fallback || archiveFallback,
      };
    } catch (e) {
      if (e instanceof DailyStartError) throw e;
      throw new DailyStartError("invalid");
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
  }
}
