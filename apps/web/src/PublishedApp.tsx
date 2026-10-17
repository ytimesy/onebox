import { useEffect, useRef, useState } from "react";
import App from "./App";
import {
  validateManifest,
  validatePublishedPuzzle,
  selectPublishedProblem,
  readPublicJson,
  type ReleaseManifest,
  type PublishedProblem,
  type PublicArchive,
} from "../../../packages/game-core/release.ts";
import type { Puzzle } from "../../../packages/game-core/index.ts";
import {
  cachedManifest,
  cachedArchive,
  cachedPuzzle,
  rememberPublicData,
} from "./public-cache";
import {
  recheckDailyStart,
  DailyStartError,
  assertKnownRecalls,
} from "./daily-start";
import { loadArchive } from "./public-archive";

const legacyPractice =
  import.meta.env.VITE_STAGE === "daily" &&
  /^\/(ja|en)\/p\/playtest-fixed-v1\/$/.test(location.pathname);
const dailyPreview =
  import.meta.env.VITE_STAGE === "daily-preview" ||
  (import.meta.env.VITE_STAGE === "daily" && !legacyPractice);
type Loaded = {
  puzzle: Puzzle;
  manifest: ReleaseManifest;
  entry: PublishedProblem;
  fallback: boolean;
  updated?: boolean;
  archive?: PublicArchive;
  archived?: boolean;
  denied?: "withdrawn" | "missing";
};
export default function PublishedApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null),
    [failed, setFailed] = useState(false),
    [unavailable, setUnavailable] = useState<false | "problem" | "all">(false),
    [retry, setRetry] = useState(0);
  const ja = !location.pathname.startsWith("/en/");
  const startController = useRef<AbortController | null>(null);
  useEffect(() => () => startController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(),
      deadline = setTimeout(() => controller.abort(), 10000);
    let mounted = true;
    setFailed(false);
    setUnavailable(false);
    setLoaded(null);
    (async () => {
      let manifest: ReleaseManifest | undefined,
        fallback = false;
      let response: Response;
      try {
        response = await fetch(
          legacyPractice ? "/practice-release.json" : "/release.json",
          {
            cache: "no-cache",
            signal: controller.signal,
          },
        );
        if (response.status >= 500) throw Error("Manifest unavailable");
      } catch (error) {
        if (!dailyPreview || !mounted) throw error;
        manifest = cachedManifest() ?? undefined;
        if (!manifest) throw error;
        fallback = true;
        response = undefined as never;
      }
      // Invalid manifest/payload/hash never fall back silently to cached data.
      manifest ??= validateManifest(await readPublicJson(response!, 1000000));
      if (
        dailyPreview
          ? manifest.stage !== "daily"
          : manifest.stage !== "playtest"
      )
        throw Error("Build stage mismatch");
      if (dailyPreview && !fallback) {
        assertKnownRecalls(manifest, cachedManifest());
        rememberPublicData(manifest);
      }
      let archive: PublicArchive | undefined;
      let selected = selectPublishedProblem(
        manifest,
        location.pathname,
        location.search,
      );
      if (
        !selected &&
        dailyPreview &&
        /^\/(ja|en)\/p\/onebox-\d{4}-\d{2}-\d{2}\/$/.test(location.pathname) &&
        (!location.search || location.search === "?src=share")
      ) {
        const cached = fallback ? await cachedArchive(manifest) : null;
        const result = fallback
          ? cached
            ? { archive: cached, fallback: true }
            : null
          : await loadArchive(manifest, controller.signal);
        archive = result?.archive;
        fallback ||= !!result?.fallback;
        selected = selectPublishedProblem(
          manifest,
          location.pathname,
          location.search,
          archive,
        );
      }
      if (!selected || selected.status !== "available") {
        if (mounted)
          setUnavailable(
            selected?.status === "unavailable" ? "all" : "problem",
          );
        return;
      }
      const entry = selected.entry;
      let payload: unknown;
      if (fallback) {
        payload = await cachedPuzzle(entry);
        if (!payload) throw Error("This fixed puzzle has not been cached");
      } else {
        let payloadResponse: Response;
        try {
          payloadResponse = await fetch(entry.payload_url, {
            cache: "no-cache",
            signal: controller.signal,
          });
          if (payloadResponse.status >= 500) throw Error("Payload unavailable");
        } catch (error) {
          if (!dailyPreview || !mounted) throw error;
          payload = await cachedPuzzle(entry);
          if (!payload) throw error;
          fallback = true;
          payloadResponse = undefined as never;
        }
        if (!fallback) payload = await readPublicJson(payloadResponse!, 10000);
      }
      const value = await validatePublishedPuzzle(payload, entry);
      if (!mounted) return;
      if (dailyPreview && !fallback) {
        rememberPublicData(manifest, value, archive);
      }
      setLoaded({
        puzzle: value,
        manifest,
        entry,
        fallback,
        archive,
        archived: !manifest.recent.some((e) => e.puzzle_id === entry.puzzle_id),
      });
    })()
      .catch(() => {
        if (mounted) setFailed(true);
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      mounted = false;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [retry]);
  if (loaded)
    return (
      <App
        initialPuzzle={loaded.puzzle}
        publication={dailyPreview ? loaded : undefined}
        historyEntries={
          dailyPreview
            ? async (signal) => {
                const result = await loadArchive(loaded.manifest, signal);
                if (result)
                  rememberPublicData(
                    loaded.manifest,
                    loaded.puzzle,
                    result.archive,
                  );
                return result?.archive.entries ?? loaded.manifest.recent;
              }
            : undefined
        }
        beforeStart={
          dailyPreview
            ? async (signal) => {
                const controller = new AbortController();
                startController.current?.abort();
                startController.current = controller;
                const abort = () => controller.abort();
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) abort();
                try {
                  const checked = await recheckDailyStart(
                    loaded,
                    location.pathname,
                    location.search,
                    controller.signal,
                  );
                  if (controller.signal.aborted) throw Error("Start cancelled");
                  setLoaded(checked);
                  return (
                    checked.fallback ||
                    !!checked.updated ||
                    checked.manifest.release_status === "delayed"
                  );
                } catch (e) {
                  if (
                    !controller.signal.aborted &&
                    e instanceof DailyStartError &&
                    e.manifest
                  )
                    setLoaded({
                      ...loaded,
                      manifest: e.manifest,
                      denied: e.code === "invalid" ? loaded.denied : e.code,
                    });
                  throw e;
                } finally {
                  signal.removeEventListener("abort", abort);
                }
              }
            : undefined
        }
      />
    );
  return (
    <main>
      <h1>ONEBOX</h1>
      <p role="status">
        {unavailable === "all"
          ? ja
            ? "現在遊べる日次問題はありません。時間をおいて再確認してください。"
            : "No daily puzzle is currently available. Please check again later."
          : unavailable
            ? ja
              ? "この問題は利用できません。"
              : "This puzzle is unavailable."
            : failed
              ? ja
                ? "問題を読み込めませんでした。もう一度試してください。"
                : "Could not load the puzzle. Please try again."
              : ja
                ? "読み込み中…"
                : "Loading…"}
      </p>
      {(failed || unavailable) && (
        <button onClick={() => setRetry((v) => v + 1)}>
          {ja ? "もう一度読み込む" : "Try again"}
        </button>
      )}
    </main>
  );
}
