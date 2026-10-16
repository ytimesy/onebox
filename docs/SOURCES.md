# 技術参照資料
確認日: 2026-10-12。以下は外部仕様を確認するための一次資料/公式資料。
この企画のルール・難易度目標・利用者数目標・収益化案は、これらの資料が保証するものではない。
価格・上限・ブラウザー対応・ライブラリ版は実装時/公開前にも再確認する。

## S1 — MDN / Web Share API
`https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API`
HTTPS、利用者操作からの呼出し、対応確認、OSの共有機構を利用する点。

## S2 — W3C / WCAG 2.2 Understanding: Dragging Movements
`https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html`
ドラッグに単一ポインターの非ドラッグ代替を用意する考え方。キーボード代替だけでは別の要件を満たすとは限らない。

## S3 — W3C / WCAG 2.2 Understanding: Target Size (Minimum)
`https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html`
24×24 CSS pxと例外条件。製品設計の44px目標は、この資料の最低基準そのものではない。

## S4 — W3C / WCAG 2.2 Understanding: Timing Adjustable
`https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html`
時間制限の無効化、調整、延長と例外の考え方。今回の1分目標は強制終了ではない。

## S5 — Cloudflare / Workers Static Assets: Billing and Limitations
`https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/`
静的アセットの配信とWorker実行の費用/制限の区別、run_worker_first利用時の注意。

## S6 — Donald E. Knuth / Dancing links (2000)
`https://arxiv.org/abs/cs/0011047`
図形敷き詰め等の組合せ探索の背景。参照実装はDancing Linksのリンク構造を使用していない。

## S7 — MDN / Window: localStorage property
`https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage`
オリジンごとの保存、ブラウザーセッション間保持、プライベートモードと保存拒否の注意。

## S8 — Cloudflare / Static Assets: Headers
`https://developers.cloudflare.com/workers/static-assets/headers/`
静的配信ヘッダーの実装確認先。実際のキャッシュ挙動はstagingで検証する。

## S9 — Cloudflare / Static Assets: HTML handling
`https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/`
固定URLや末尾スラッシュ等の扱いの実装確認先。
