# 固定practiceの履歴表示・公開証跡

2026-10-13（JST）。ユーザーの継続開発・公開更新・残件報告の依頼に従い、T33の端末内履歴を固定practiceへ追加し、このPCのHTTPS公開環境へ反映した。正式日次版の受入は未完了。

## 変更

- 公開日英トップ/固定URLの「直近7回の記録」から、このブラウザーに残る当該固定問題のrunを開始日時順に最大7回表示。練習も1回として数える。
- 保存記録をゲーム共通のhash/ルール/配置判定で検査。操作練習・別問題・壊れた記録・不正な完成・keyとrunの不一致・終了日時と状態の不一致を除外。閲覧によって元の記録を削除/上書きしない。
- 完成/未完了/解答表示、初回/練習、ヒント、中断を維持。現在または記録時の時間非表示、または不確かな時計なら時間を表示しない。日時は端末の現地時間、時間は端末内の自己記録。
- 進行中に履歴を開くと一時停止。閉じた後は履歴ボタンへフォーカスを戻し、ゲームの再開は明示操作。保存不能時は一時記録の警告を表示。別タブで削除されたキーを確認したらメモリーからも除く。
- 記録をサーバーへ送信せず、未参加ペナルティや課金を追加しない。日次配信と次回日時は準備中/未定と明記。正式日次の履歴・次回時刻・過去問から今日の問題への遷移は未実装。

主な変更: `apps/web/src/RecentAttempts.tsx`、`App.tsx`、`storage.ts`、`style.css`、`packages/game-core/storage.test.ts`、`scripts/check-history.mjs`、`scripts/check-public-boundary.mjs`。仕様と進捗はSPEC/TASK/AGENTS/DECISIONS/READMEへ反映。

## 検証

| 確認 | 結果 |
| --- | --- |
| 型/ビルド | public/private両方で型検査成功。allowlist・PRIVATE/未来問題の混入検査成功 |
| 単体 | `npm test` 51件成功。追加3件で7回の順序・再読込、異常/別問題/操作練習の除外と読み取り専用、保存不能/別タブ削除/メモリー継続を確認 |
| 既存ゲーム | `npm run test:e2e` 87件成功（29×3エンジン、1.8分）。[M1回帰](../evidence/history-m1-regression.txt) |
| ローカル公開生成物 | `npm run check:history`、Chromium156.0.8078.4/Firefox157.0/WebKit27.2×日英6フローと保存拒否確認。実UIの一時停止/ヒント/完成/再読込、合成履歴の7回/時差/異常/非表示、320/390/768/1440幅、Escape/フォーカス、アプリ記録だけの削除、サーバーへ書き込まないことを確認。[履歴検査](../evidence/history-local.txt) |
| 共有回帰 | `npm run check:sharing`、同じ生成物で3エンジン×日英6フロー成功。[共有検査](../evidence/sharing-local.txt) |
| 非公開試遊回帰 | `npm run build:reviewer`、`npm run check:reviewer` 成功。3エンジン15試遊フロー、合成報告→CLI取り込み、在庫の再確認/失敗復旧を確認。実台帳は不変。[候補画面回帰](../evidence/history-reviewer-regression.txt) |
| HTTPS履歴 | `npm run check:history -- https://onebox.formflow-ops.com`、Chromium日英2フローと保存拒否確認に成功。[公開履歴検査](../evidence/history-public.txt) |
| HTTPSゲーム/共有 | 公開URLで `check:playtest` と `check:sharing` に成功。日英の開始/ヒント/完遂・保存、固定共有URL、時差/翌日hash、PNG保存、4幅、CSPを確認。[公開操作](../evidence/public-smoke.txt)、[公開共有](../evidence/sharing-public.txt) |
| 配備境界 | `node scripts/check-public-boundary.mjs` 成功。現行/旧public assetsはHTTPS200でSHA一致、private API/画面/専用assets/内部文書/未実装manifestは404。実台帳と共用Cloudflare設定は変更なし。[境界検査](../evidence/history-public-boundary.json) |

履歴検査の多数の記録・破損した完成は使い捨てのブラウザーcontextへ注入した合成データ。人間の試遊、実際の9回参加、端末の実機認証には数えない。[390px公開画面](../evidence/history-public-phone.png)も合成データの境界確認で、警告は意図的な破損記録によるもの。実物スマートフォンの画像ではない。画面を目視して文字とスクロール可能な履歴を確認した。

初回の英語検査でPlaceという部分一致が盤面のplacement previewにも一致したため、検査対象を操作ボタンの領域へ絞った。WebKitで履歴を閉じた後のフォーカス復帰が失敗したため、アプリに明示的な復帰を実装して全3エンジンを再確認した。PythonのHTTPS検査はローカルCA設定不足で失敗したため証明書検証を無効化せず、OSのcurlとNode/PlaywrightでHTTPSを検証した。

## 配備

公開URL: https://onebox.formflow-ops.com/ja/ と https://onebox.formflow-ops.com/en/ 。固定URLは既存の `/ja/p/playtest-fixed-v1/` と英語版。

release `m1-f1119610d9e9`、digest `f1119610d9e91204dd2a69eab4819b946d9e13a0ebcf47f631bf53c74bad7485`。同じ生成物をローカル検証後にdigest一致でpromoteし、再buildしなかった。前版 `m1-d08d7b1644af` はvar/previousとvar/assetsに保持。public JS+CSS+Worker gzip87,775 bytes。private reviewerは別出力、gzip88,622 bytesで公開へコピーしていない。

public payload hashは従来と同じ `b30042deab13615c3fb6c3c1082f7d457607ee9e0ffa82ba077d416f5406c9b3`。日次問題へ置き換えていない。配信サーバーの変更は不要で、web PID5382/tunnel PID14063/reviewer PID75322を再起動せず切り替えた。

実台帳はrevision1、候補5、試遊報告0、承認0、有効公開待ち0、正式公開0。読み取り専用の在庫確認と、更新前後の台帳SHA一致を確認した。合成確認や固定問題の公開更新を品質30問へ数えない。

## 残件

T30の日次manifest・日次公開/更新/hash・撤回・正式公開履歴、T22の非公開スマートフォン試遊導線と品質確認済み30問、T31/T32/T33の正式日次接続・現地更新時刻・過去問から今日への遷移が残る。

M1の実物iPhone/Androidでの一問完遂・ドラッグ/スクロール・VoiceOver/TalkBack、実OS共有、人間20人程度の操作観察、初回100件程度/10〜14日以上の継続観測、任意集計の採否、残る依存/性能/セキュリティ受入、PC再起動・ログイン状態・物理停止からの復旧・複数地点確認は未完了。M5は初版の必須残件ではなく別範囲。

公開トップで既知のGoogle gateway挿入に対するCSP遮断3件ずつを引き続き確認。タグ実行/Cookie/計測応答は観測なし。共用zoneの変更は行わず、タグ非挿入/CSP違反0件の受入を完了にしない。OS共有/clipboardは模擬成否で、実SNS投稿ではない。
