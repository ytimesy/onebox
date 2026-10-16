import { useCallback, useEffect, useRef, useState } from "react";
import App from "../../web/src/App";
import {
  type Attempt,
  type Puzzle,
  hashPuzzle,
  validateAttempt,
  validatePuzzle,
} from "../../../packages/game-core/index.ts";
import {
  humanReport,
  observe,
  type Observation,
} from "../../../packages/game-core/trial-observation.ts";
import type { Trial } from "../../../packages/puzzle-tools/curation.ts";
import InventoryPanel from "./InventoryPanel";

interface Candidate {
  id: string;
  stage: string;
  eligible: boolean;
  recorded_trials: number;
}
interface Loaded {
  puzzle: Puzzle;
  hash: string;
}
const prefix = "onebox-review:v1:observation:";
export default function Reviewer() {
  const [entries, setEntries] = useState<Candidate[]>([]),
    [loaded, setLoaded] = useState<Loaded | null>(null),
    [drafts, setDrafts] = useState<Observation[]>([]),
    [report, setReport] = useState<Observation | null>(null),
    [error, setError] = useState(""),
    [warning, setWarning] = useState(false),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [device, setDevice] = useState<Trial["device"]>("desktop"),
    [input, setInput] = useState<Trial["input"]>("touch"),
    [confusion, setConfusion] = useState<Trial["confusion"]>("none"),
    [exported, setExported] = useState<string[]>([]);
  const observations = useRef(new Map<string, Observation>()),
    dialog = useRef<HTMLDialogElement>(null),
    request = useRef(0);
  useEffect(() => {
    fetch("/api/candidates", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((r) => setEntries(r.entries))
      .catch(() =>
        setError(
          "候補台帳を読み込めません。台帳とサーバーを確認してください。",
        ),
      );
  }, []);
  useEffect(() => {
    if (report) dialog.current?.showModal();
    else dialog.current?.close();
  }, [report]);
  async function load(id: string) {
    const generation = ++request.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/candidate/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!r.ok) throw Error();
      const body = await r.json(),
        puzzle = validatePuzzle(body.puzzle);
      if (
        puzzle.purpose !== "design_verification_only" ||
        (await hashPuzzle(puzzle)) !== body.hash
      )
        throw Error();
      if (generation !== request.current) return;
      try {
        for (const key of Object.keys(localStorage).filter((k) =>
          k.startsWith(prefix),
        )) {
          try {
            const o = JSON.parse(localStorage.getItem(key)!);
            if (o.kind !== "browser_observation" || o.attempt?.puzzle_id !== id)
              continue;
            validateAttempt(o.attempt, puzzle, body.hash);
            if (
              !["ja", "en"].includes(o.locale) ||
              typeof o.first_piece_placed !== "boolean"
            )
              throw Error();
            observations.current.set(o.attempt.run_id, o);
          } catch {
            setWarning(true);
          }
        }
      } catch {
        setWarning(true);
      }
      setDrafts(
        [...observations.current.values()].filter(
          (o) => o.attempt.puzzle_id === id,
        ),
      );
      setLoaded({ puzzle, hash: body.hash });
    } catch {
      if (generation === request.current)
        setError(
          "候補を読み込めません。重複や台帳の検査結果を確認してください。",
        );
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }
  const recordObservation = useCallback((a: Attempt, locale: "ja" | "en") => {
    const o = observe(a, locale, observations.current.get(a.run_id));
    observations.current.set(a.run_id, o);
    try {
      localStorage.setItem(prefix + a.run_id, JSON.stringify(o));
    } catch {
      setWarning(true);
    }
    setDrafts(
      [...observations.current.values()].filter(
        (o) => o.attempt.puzzle_id === a.puzzle_id,
      ),
    );
  }, []);
  function openReport(o: Observation) {
    setConfirmed(false);
    setConfusion("none");
    setError("");
    setReport(o);
  }
  function download() {
    if (!report || !loaded) return;
    try {
      const value = humanReport(report, loaded.puzzle, loaded.hash, {
        confirmed,
        device,
        input,
        confusion,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2) + "\n"], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `trial-${loaded.puzzle.puzzle_id}-${value.trial_id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setExported((old) => [...new Set([...old, value.trial_id])]);
      setReport(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const currentlyPlaying = drafts.some((o) => o.attempt.state === "playing");
  return (
    <>
      <section className="review-panel" aria-label="候補試遊">
        <h1>候補を試す</h1>
        <p>
          非公開の試遊画面です。候補は未承認で、日次配信には含まれません。PC内またはアクセスコード付きのLAN内HTTPSで利用します。
        </p>
        <p>
          操作の下書きはこのブラウザーに保存します。人間の結果は確認後にJSONを書き出し、編集CLIで取り込みます。
        </p>
        <label>
          候補
          <select
            value={loaded?.puzzle.puzzle_id ?? ""}
            disabled={busy || currentlyPlaying}
            onChange={(e) => {
              if (e.target.value) void load(e.target.value);
            }}
          >
            <option value="" disabled>
              選んでください
            </option>
            {entries.map((e) => (
              <option key={e.id} value={e.id} disabled={!e.eligible}>
                {e.id} · {e.stage} · 記録{e.recorded_trials}件
                {e.eligible ? "" : " · 重複あり"}
              </option>
            ))}
          </select>
        </label>
        {currentlyPlaying && (
          <p>
            未完了で記録する場合は「終了して試遊を記録」、後で続きを遊ぶ場合は一時停止を選んでください。
          </p>
        )}
        {busy && <p role="status">読み込み中…</p>}
        {warning && (
          <p role="status">
            下書きの保存・復元に問題があります。このページを閉じる前に記録を書き出してください。
          </p>
        )}
        {error && !report && <p role="alert">{error}</p>}
      </section>
      {loaded && (
        <App
          key={loaded.puzzle.puzzle_id}
          initialPuzzle={loaded.puzzle}
          reviewer
          onAttempt={recordObservation}
          onReport={(a, locale) => {
            const o = observe(a, locale, observations.current.get(a.run_id));
            openReport(o);
          }}
        />
      )}
      {drafts.length > 0 && (
        <section className="review-panel" aria-label="試遊の下書き">
          <h2>試遊の下書き（{drafts.length}件）</h2>
          <p>
            書き出していない開始・未完了もここに残ります。書き出しは台帳への取り込み完了を意味しません。
          </p>
          <ul>
            {drafts.map((o) => (
              <li key={o.attempt.run_id}>
                {o.attempt.mode === "first" ? "初回" : "練習"} ·{" "}
                {o.attempt.state === "completed" ? "完了" : "未完了"} ·{" "}
                {(o.attempt.active_elapsed_ms / 1000).toFixed(1)}秒 · ヒント
                {o.attempt.hint_count}回 ·{" "}
                {o.attempt.interrupted ? "中断あり" : "中断なし"}
                <button
                  disabled={["playing", "paused"].includes(o.attempt.state)}
                  onClick={() => openReport(o)}
                >
                  {exported.includes(o.attempt.run_id)
                    ? "もう一度書き出す"
                    : "記録を確認"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <InventoryPanel />
      <dialog
        className="review-panel review-report"
        ref={dialog}
        onCancel={() => setReport(null)}
      >
        <h2>試遊結果を確認</h2>
        {report && (
          <>
            <p>{loaded?.puzzle.puzzle_id}</p>
            <p>
              {report.attempt.state === "completed"
                ? "完了"
                : "未完了（答えの表示も未完了）"}{" "}
              · {(report.attempt.active_elapsed_ms / 1000).toFixed(1)}秒 ·
              ヒント{report.attempt.hint_count}回 ·{" "}
              {report.first_piece_placed ? "1ピース以上配置" : "配置なし"}
            </p>
            <p>
              {report.attempt.mode === "first" ? "初回" : "練習"} ·{" "}
              {report.attempt.interrupted ? "中断あり" : "中断なし"} · 言語
              {report.locale}
            </p>
            <label>
              実際に操作した端末
              <select
                value={device}
                onChange={(e) => {
                  setDevice(e.target.value as Trial["device"]);
                  setConfirmed(false);
                }}
              >
                <option value="desktop">PC</option>
                <option value="phone">スマートフォン</option>
              </select>
            </label>
            <p>
              端末の自己申告です。自動試験や画面幅だけでは実機確認になりません。
            </p>
            <label>
              主な操作
              <select
                value={input}
                onChange={(e) => {
                  setInput(e.target.value as Trial["input"]);
                  setConfirmed(false);
                }}
              >
                <option value="touch">タップ／クリック</option>
                <option value="drag">ドラッグ</option>
                <option value="keyboard">キーボード</option>
              </select>
            </label>
            <label>
              操作で迷ったところ
              <select
                value={confusion}
                onChange={(e) => {
                  setConfusion(e.target.value as Trial["confusion"]);
                  setConfirmed(false);
                }}
              >
                <option value="none">なし</option>
                <option value="anchor">置く位置の基準</option>
                <option value="rotation">回転</option>
                <option value="drag">ドラッグ</option>
                <option value="other">その他</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              実際に自分が操作した結果で、端末・操作・迷いの入力を確認しました。
            </label>
            <p>
              未完了も記録してください。自動テストの結果を人間の試遊として取り込まないでください。
            </p>
            {error && <p role="alert">{error}</p>}
            <button onClick={download} disabled={!confirmed}>
              JSONを書き出す
            </button>
            <button onClick={() => setReport(null)}>閉じる</button>
          </>
        )}
      </dialog>
    </>
  );
}
