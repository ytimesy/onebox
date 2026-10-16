import { useEffect, useRef, useState } from "react";
import type { Attempt, Puzzle } from "../../../packages/game-core";
import { hashPuzzle } from "../../../packages/game-core";
import type { Locale } from "./i18n";
import { store } from "./storage";

export default function RecentAttempts({
  puzzle,
  locale,
  timerVisible,
  onOpen,
}: {
  puzzle: Puzzle;
  locale: Locale;
  timerVisible: boolean;
  onOpen: () => void;
}) {
  const ja = locale === "ja",
    dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [records, setRecords] = useState<Attempt[]>([]);
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
      aria-label={ja ? "試遊の記録" : "Practice records"}
    >
      <button
        ref={trigger}
        disabled={!hash}
        onClick={() => {
          onOpen();
          setRecords(store.recent(puzzle, hash));
          setOpen(true);
        }}
      >
        {ja ? "直近7回の記録" : "Last 7 attempts"}
      </button>
      <p className="local-note">
        {ja
          ? "日次配信は準備中です。次回更新日時はまだ決まっていません。"
          : "Daily puzzles are being prepared. The next update time is not yet scheduled."}
      </p>
      <dialog
        ref={dialog}
        className="recent-dialog"
        aria-labelledby="recent-title"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <div className="dialog-header">
          <h2 id="recent-title">{ja ? "直近7回の記録" : "Last 7 attempts"}</h2>
          <button
            aria-label={ja ? "閉じる" : "Close"}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <p>
          {ja
            ? "このブラウザーに残っている固定問題の記録です。練習も1回ずつ数えます。日時は端末の現地時間、時間は端末内の自己記録です。"
            : "Saved attempts for this fixed puzzle in this browser. Each practice counts separately. Dates use your local time; times are personal device records."}
        </p>
        {store.warning && (
          <p role="status">
            {ja
              ? "一部の記録を読み込めないか、保存できていません。このページの一時記録だけの場合もあります。"
              : "Some records could not be read or saved. Records may only last for this page."}
          </p>
        )}
        {!records.length ? (
          <p>{ja ? "まだ記録はありません。" : "No attempts saved yet."}</p>
        ) : (
          <ol className="recent-list">
            {records.map((a) => (
              <li key={a.run_id}>
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
                      : `${(a.active_elapsed_ms / 1000).toFixed(1)} ${ja ? "秒" : "s"}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        <button className="primary" onClick={() => setOpen(false)}>
          {ja ? "固定問題に戻る" : "Back to the fixed puzzle"}
        </button>
      </dialog>
    </section>
  );
}
