import {
  readPublicJson,
  validatePublishedArchive,
  type ReleaseManifest,
} from "../../../packages/game-core/release.ts";
import { cachedArchive } from "./public-cache";
export class ArchiveNetworkError extends Error {}
export async function loadArchive(
  manifest: ReleaseManifest,
  signal?: AbortSignal,
) {
  if (!manifest.archive) return null;
  let response: Response;
  try {
    response = await fetch(manifest.archive.url, { cache: "no-cache", signal });
    if (response.status >= 500)
      throw new ArchiveNetworkError("Archive unavailable");
  } catch (e) {
    if (signal?.aborted) throw e;
    const archive = await cachedArchive(manifest);
    if (archive) return { archive, fallback: true };
    throw new ArchiveNetworkError("No verified cached archive");
  }
  return {
    archive: await validatePublishedArchive(
      await readPublicJson(response, 4000000),
      manifest,
    ),
    fallback: false,
  };
}
