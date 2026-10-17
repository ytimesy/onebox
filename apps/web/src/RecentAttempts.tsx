import { useEffect, useRef, useState } from "react";
import type { Attempt, Puzzle } from "../../../packages/game-core";
import { hashPuzzle, secondsText } from "../../../packages/game-core";
import type { Locale } from "./i18n";
import { store } from "./storage";
import { cachedPuzzle } from "./public-cache";
import {
  readPublicJson,
  validatePublishedPuzzle,
  type ReleaseManifest,
  type PublishedProblem,
} from "../../../packages/game-core/release";

export default function RecentAttempts({
  puzzle,
  locale,
  timerVisible,
  onOpen,
  manifest,
  loadEntries,
  currentEntry,
}: {
  puzzle: Puzzle;
  locale: Locale;
  timerVisible: boolean;
  onOpen: () => void | Promise<void>;
  manifest?: ReleaseManifest;
  loadEntries?: (signal: AbortSignal) => Promise<PublishedProblem[]>;
  currentEntry?: PublishedProblem;
}) {
  const ja = locale === "ja",
    dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [records, setRecords] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const [entries, setEntries] = useState<PublishedProblem[]>(
    manifest?.recent ?? [],
  );
  const request = useRef(0),
    abort = useRef<AbortController | null>(null);
  function close() {
    request.current++;
    abort.current?.abort();
    setBusy(false);
    setOpen(false);
  }
  useEffect(
    () => () => {
      request.current++;
      abort.current?.abort();
    },
    [],
  );
  const [hash, setHash] = useState("");
  useEffect(() => {
    let cancelled = false;
    hashPuzzle(puzzle)
      .then((value) => {
        if (!cancelled) setHash(value);
      })
      .catch(() => {
        if (!cancelled) setHash("");
      });
    return () => {
      cancelled = true;
    };
  }, [puzzle]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <section
      className="recent-section"
      aria-label={
        manifest
          ? ja
            ? "日次問題の記録"
            : "Daily puzzle records"
          : ja
            ? "試遊の記録"
            : "Practice records"
      }
    >
      <button
        ref={trigger}
        disabled={!hash || busy}
        onClick={async () => {
          const ticket = ++request.current;
          setBusy(true);
          setUnavailable(false);
          setRecords([]);
          const controller = new AbortController();
          abort.current = controller;
          const deadline = setTimeout(() => controller.abort(), 10000);
          try {
            await onOpen();
            if (ticket !== request.current) return;
            setOpen(true);
            if (!manifest) setRecords(store.recent(puzzle, hash));
            else {
              let published = manifest.recent,
                incomplete = false;
              try {
                if (loadEntries)
                  published = await loadEntries(controller.signal);
              } catch {
                incomplete = true;
              }
              if (ticket !== request.current) return;
              if (controller.signal.aborted) {
                setUnavailable(true);
                return;
              }
              published = [
                ...new Map(
                  [...published, ...(currentEntry ? [currentEntry] : [])].map(
                    (e) => [e.puzzle_id, e],
                  ),
                ).values(),
              ].filter((e) => !manifest.recalled_ids.includes(e.puzzle_id));
              setEntries(published);
              const result = await store.recentPublished(
                published,
                async (entry) => {
                  if (entry.puzzle_id === puzzle.puzzle_id) return puzzle;
                  const saved = await cachedPuzzle(entry);
                  if (saved) return saved;
                  return validatePublishedPuzzle(
                    await readPublicJson(
                      await fetch(entry.payload_url, {
                        cache: "no-cache",
                        signal: controller.signal,
                      }),
                      10000,
                    ),
                    entry,
                  );
                },
              );
              if (ticket !== request.current) return;
              setRecords(result.records);
              setUnavailable(result.unavailable || incomplete);
            }
          } catch {
            if (ticket === request.current) setUnavailable(true);
          } finally {
            clearTimeout(deadline);
            if (ticket === request.current) setBusy(false);
          }
        }}
      >
        {ja ? "直近7回の記録" : "Last 7 attempts"}
      </button>
      {!manifest && (
        <p className="local-note">
          {ja
            ? "日次配信は準備中です。次回更新日時はまだ決まっていません。"
            : "Daily puzzles are being prepared. The next update time is not yet scheduled."}
        </p>
      )}
      <dialog
        ref={dialog}
        className="recent-dialog"
        aria-labelledby="recent-title"
        onCancel={close}
        onClose={() => {
          close();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className="dialog-header">
          <h2 id="recent-title">{ja ? "直近7回の記録" : "Last 7 attempts"}</h2>
          <button aria-label={ja ? "閉じる" : "Close"} onClick={close}>
            ×
          </button>
        </div>
        <p>
          {manifest
            ? ja
              ? "このブラウザーに残る公開済み日次問題の記録です。練習も1回ずつ数えます。日時は端末の現地時間、時間は端末内の自己記録です。"
              : "Saved attempts across published daily puzzles in this browser. Each practice counts separately. Dates use your local time; times are personal device records."
            : ja
              ? "このブラウザーに残っている固定問題の記録です。練習も1回ずつ数えます。日時は端末の現地時間、時間は端末内の自己記録です。"
              : "Saved attempts for this fixed puzzle in this browser. Each practice counts separately. Dates use your local time; times are personal device records."}
        </p>
        {busy && (
          <p role="status">{ja ? "記録を確認中…" : "Checking records…"}</p>
        )}
        {unavailable && (
          <p role="status">
            {ja
              ? "一部の問題を確認できないため、その記録を表示できません。記録は削除していません。通信が戻ったら開き直してください。"
              : "Some puzzles could not be verified, so their records are hidden. Nothing was deleted. Reopen after reconnecting."}
          </p>
        )}
        {store.warning && (
          <p role="status">
            {ja
              ? "一部の記録を読み込めないか、保存できていません。このページの一時記録だけの場合もあります。"
              : "Some records could not be read or saved. Records may only last for this page."}
          </p>
        )}
        {!records.length && !busy && !unavailable ? (
          <p>{ja ? "まだ記録はありません。" : "No attempts saved yet."}</p>
        ) : (
          <ol className="recent-list">
            {records.map((a) => (
              <li key={a.run_id}>
                {manifest && (
                  <a
                    href={`/${locale}/p/${entries.find((e) => e.puzzle_id === a.puzzle_id)!.slug}/`}
                  >
                    {
                      entries.find((e) => e.puzzle_id === a.puzzle_id)!
                        .edition_utc
                    }
                  </a>
                )}
                <time dateTime={a.started_at_client}>
                  {new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(a.started_at_client))}
                </time>
                <strong>
                  {a.state === "completed"
                    ? ja
                      ? "完成"
                      : "Completed"
                    : a.state === "revealed"
                      ? ja
                        ? "解答を表示 · 未完了"
                        : "Solution viewed · Unfinished"
                      : ja
                        ? "未完了"
                        : "Unfinished"}
                </strong>
                <span>
                  {a.mode === "first"
                    ? ja
                      ? "初回"
                      : "First attempt"
                    : ja
                      ? "練習"
                      : "Practice"}{" "}
                  · {ja ? "ヒント" : "Hints"}: {a.hint_count} ·{" "}
                  {a.interrupted
                    ? ja
                      ? "中断あり"
                      : "Interrupted"
                    : ja
                      ? "中断なし"
                      : "No interruption"}
                </span>
                <span>
                  {!timerVisible || !a.timer_visible
                    ? ja
                      ? "時間非表示"
                      : "Time hidden"
                    : a.clock_status === "uncertain"
                      ? ja
                        ? "時計が不確かなため時間非表示"
                        : "Time unavailable: uncertain clock"
                      : `${secondsText(a.active_elapsed_ms)} ${ja ? "秒" : "s"}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        <button className="primary" onClick={close}>
          {manifest
            ? ja
              ? "問題に戻る"
              : "Back to the puzzle"
            : ja
              ? "固定問題に戻る"
              : "Back to the fixed puzzle"}
        </button>
      </dialog>
    </section>
  );
}
