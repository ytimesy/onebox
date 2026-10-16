import { useEffect, useState } from "react";
import App from "./App";
import {
  validateManifest,
  validatePublishedPuzzle,
} from "../../../packages/game-core/release.ts";
import type { Puzzle } from "../../../packages/game-core/index.ts";

export default function PublishedApp() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const ja = !location.pathname.startsWith("/en/");
  useEffect(() => {
    const controller = new AbortController(),
      deadline = setTimeout(() => controller.abort(), 10000);
    setFailed(false);
    setPuzzle(null);
    (async () => {
      const response = await fetch("/release.json", {
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!response.ok) throw Error();
      const manifest = validateManifest(await response.json());
      // Daily activation requires a separate accepted daily build; never reinterpret
      // the practice app's labels/scoring as a formal daily edition.
      if (manifest.stage !== "playtest") throw Error();
      const payload = await fetch(manifest.active.payload_url, {
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!payload.ok) throw Error();
      const value = await validatePublishedPuzzle(
        await payload.json(),
        manifest.active,
      );
      if (!controller.signal.aborted) setPuzzle(value);
    })()
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
        else if (!controller.signal.reason?.unmount) setFailed(true);
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      controller.abort({ unmount: true });
    };
  }, [retry]);
  if (puzzle) return <App initialPuzzle={puzzle} />;
  return (
    <main>
      <h1>ONEBOX</h1>
      <p role="status">
        {failed
          ? ja
            ? "問題を読み込めませんでした。もう一度試してください。"
            : "Could not load the puzzle. Please try again."
          : ja
            ? "読み込み中…"
            : "Loading…"}
      </p>
      {failed && (
        <button onClick={() => setRetry((v) => v + 1)}>
          {ja ? "もう一度読み込む" : "Try again"}
        </button>
      )}
    </main>
  );
}
