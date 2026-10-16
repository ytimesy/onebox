import { useEffect, useState } from "react";
import type { Inventory } from "../../../packages/puzzle-tools/inventory.ts";

const labels = {
  action_required: "要対応：公開待ちが7問未満",
  warning: "警告：公開待ちが14問未満",
  ok: "公開待ちは14問以上",
};
const percent = (n: number | null) =>
  n === null ? "未計測" : `${(n * 100).toFixed(1)}%`;
const seconds = (n: number | null) =>
  n === null ? "未計測" : `${(n / 1000).toFixed(1)}秒`;

export default function InventoryPanel() {
  const [data, setData] = useState<Inventory | null>(null),
    [busy, setBusy] = useState(true),
    [failed, setFailed] = useState(false);
  async function refresh() {
    setBusy(true);
    setFailed(false);
    setData(null);
    try {
      const r = await fetch("/api/inventory", { cache: "no-store" });
      if (!r.ok) throw Error();
      setData(await r.json());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section className="review-panel inventory" aria-label="在庫と試遊集計">
      <h2>在庫と試遊集計</h2>
      <button disabled={busy} onClick={() => void refresh()}>
        在庫を再確認
      </button>
      {busy && <p role="status">台帳を確認中…</p>}
      {failed && (
        <p role="alert">
          台帳を確認できません。在庫数は不明です。サーバーと台帳を確認し、再確認してください。
        </p>
      )}
      {data && (
        <>
          <p role="status" className={`stock-${data.stock.level}`}>
            {labels[data.stock.level]}
          </p>
          <p data-testid="ready-stock">
            検査が有効な公開待ち：{data.ready}問 / 目標{data.stock.target}
            問（不足{data.stock.shortfall}問）
          </p>
          <p>
            台帳 revision {data.revision} · 確認時刻{" "}
            {new Date(data.checked_at).toLocaleString("ja-JP")}
          </p>
          <p>
            CLIで変更した後は再確認してください。JSONの書き出しだけでは集計に加わりません。
          </p>
          <dl className="inventory-counts">
            <div>
              <dt>候補</dt>
              <dd>{data.counts.candidate}問</dd>
            </div>
            <div>
              <dt>試遊中</dt>
              <dd>{data.counts.playtesting}問</dd>
            </div>
            <div>
              <dt>承認済み</dt>
              <dd>{data.counts.approved}問</dd>
            </div>
            <div>
              <dt>公開待ち登録</dt>
              <dd>{data.counts.queued}問</dd>
            </div>
            <div>
              <dt>棄却</dt>
              <dd>{data.counts.rejected}問</dd>
            </div>
          </dl>
          <p>
            公開待ちから除外：重複{data.excluded.duplicate}問、古い編集検査
            {data.excluded.stale_review}問、機械検証未確認・失敗
            {data.excluded.machine_verification}問
          </p>
          <div className="inventory-cohorts">
            {(
              [
                ["all", "全報告"],
                ["first", "初回"],
                ["practice", "練習"],
                ["phone_first", "スマートフォン初回"],
              ] as const
            ).map(([key, name]) => {
              const t = data.trials[key];
              return (
                <section key={key} aria-label={`${name}集計`}>
                  <h3>{name}</h3>
                  <p>
                    開始{t.starts}件 · 完了{t.completed}件 · 未完了
                    {t.unfinished}件
                  </p>
                  <p>
                    完了率{percent(t.completion_rate)} · 未完了率
                    {percent(t.unfinished_rate)}
                  </p>
                  <p>完了時間中央値：{seconds(t.completion_median_ms)}</p>
                  <p>
                    配置あり{t.first_piece_placed}件 · ヒントあり{t.used_hint}件
                    · 中断あり{t.interrupted}件 · 配置迷いあり{t.confused}件
                  </p>
                </section>
              );
            })}
          </div>
          <p>
            取り込み済みの手動報告だけを集計し、棄却候補の報告も含めます。未取り込みの開始・未完了は集計に含まれません。中央値は完了者のみ（ヒント・中断ありを含む）。45〜90秒は初回中央値の仮目標です。この集計や在庫数だけで人間の難易度受入・30問の品質確認・日次配信を完了にはしません。
          </p>
        </>
      )}
    </section>
  );
}
