# ONEBOX 修正報告 — 2026-10-17

最新状態: ユーザーの「修正した後は常に本番に反映していいよ」により、X投稿導線を含む固定試遊修正版を本番へ反映し、HTTPS経路で確認済み。詳細は末尾の本番反映記録。以下の初回報告・X追加節にある「本番未反映」は反映前時点の記録です。実機/人間試遊/品質30問/正式日次公開は未完了のまま。

この報告は `ONEBOX_CODEX_REVISION.md` v1.1 に対する既存実装の修正。新規アプリへの作り直しではない。本番反映・DNS・課金・外部ジョブ有効化・他サービスへの投稿は行っていない。実物端末・人間の試遊・品質受入済み30問・正式日次公開は未完了。

## 調査・再利用

作業/Gitルート `/Users/ytimesy/projects/onebox`、main、着手HEAD `dc30a95`。着手前の未コミット変更なし。適用AGENTSと既存SPEC/TASK/docs・ソース・テスト・lockfileを確認。構成はReact19.3.0/TypeScript5.9.3/Vite8.3.4、純粋game-core、Worker、localStorage、Vitest5.0.3/Playwright1.64.0を維持。依存・lockfile・rules_version・公開問題IDの変更なし。

幾何学判定、別の合法解も認める完成判定、タップ/ドラッグ/キーボード、60秒以降の続行、初回終端の保護、Workerヒントと解答確認、固定URL・解答なし共有・直近履歴、非公開生成/編集CLI・独立Python照合・公開allowlistを再利用した。原資料のTASKS.mdへ管理先を変えず、TASK.mdを更新。

差分の初期調査は [REVISION_PLAN_20261017.md](REVISION_PLAN_20261017.md)。修正前の `npm run check` は型・単体59件/9ファイル・buildが成功。初期のE2Eは修正作業と重なったため、修正前の完全なE2E証跡とは扱わない。

## 実際の修正

- I01/I04: 候補の合法/不合法を文字で表示。キャプチャ喪失で取消、別pointerの終了を無視。盤面を部分更新しない。完成には軽い収まりの演出を追加し、OS/設定のreduce motionを優先する。
- P01/P04: 任意undo_historyをv1へ互換追加。配置/移動/戻すの直近512操作を保存・復帰。旧記録は履歴なしで有効。時間・ヒント・中断・確定した初回結果は巻き戻さない。
- P02/P03/P07: 180問詳細の整理で初回識別を残す。破損currentの隔離は一意キーへ保存できた場合だけ原本を除去。隔離保存失敗なら永続原本を残す。初回性不明の印を保持し、次の読込で再初回化しない。
- P05/P06: Web Locksの問題排他と短期保存ロック。代替はIndexedDB transactionによるclaim/所有者token照合/保存/heartbeat/引継ぎ。両方不可なら共有記録を書かず、警告付き非保存練習。明示的なタブ引継ぎを追加。旧タブの遅延保存を拒否。
- T02/T03/T05/T08: 区間開始をDOM準備後へ寄せ、時計の非有限値を防御。秒/0.1秒の表示を切上げ、60,001msを60秒以内と誤認させない。非表示では達成バッジも隠す。表示設定は終端記録と別に保存。完成結果は保存処理が終わってから表示し、二重完了/二重開始を防ぐ。
- I03/P01: 非同期保存完了後の選択解除が次の操作を消す競合を修正。履歴を開く際は一時停止/保存の完了を待つ。
- S01: localhostで生成する共有文/画像は実際のローカル固定URLと「このPC用」の説明を使う。本番originを偽らない。投稿完了と表示しない。
- D01–D07: 公開固定版の経路を維持し、別のdaily-previewビルドだけに日次の問題選択/過去slug/撤回/遅延表示/取得済みキャッシュ/固定共有を接続。10KB payload/1MB manifestの読込上限。壊れたmanifest/hashをキャッシュで隠さない。合成2版のlocalhost切替/復旧を追加し、実在庫・正式日次公開へ接続しない。

## 確認環境・証跡

macOS26.5.1、Node24.6.0、Python3.13.7。Playwright管理のChromium156.0.8078.4/Firefox157.0/WebKit27.2を使用。実物のSafari/iPhone/Androidとは区別する。E2Eは専用4320の新規サーバー、1ワーカー、専用ブラウザー/保存領域を使用。

ログ/画像は `evidence/revision-20261017/`（Git対象外）。修正途中にはテストの矢印付きボタンへのセレクター不一致、保存待ち前の読み取り、次選択の消去競合、CLI単体試験の一度の5秒timeoutを確認した。セレクター/待機と実コードを修正し、最終の固定コードで再検証する。途中ログをPASS証跡へ読み替えない。

| コマンド/確認 | 状態 | 実測・証跡 |
|---|---|---|
| 修正前 npm run check | PASS | 59件、baseline-check.log |
| 最終 npm run check | PASS | 型・単体67件/9ファイル・開発build/allowlist、check-final.log |
| 最終 npm run test:e2e | PASS | 42項目×3エンジン=126件、2.3分。e2e-verified.log |
| npm run build:playtest | PASS | PRIVATE/未列挙JSON/予算検査付き。build-playtest-final.log |
| npm run build:daily-preview | PASS | evidence/daily-preview限定、合成2版、build-daily-preview-final.log |
| node scripts/check-release.mjs | PASS | 3エンジンで破損manifest/hash/rules/private/通信失敗→開始停止/明示再試行。欠損/余分なJSONのbuild拒否。release-check-final.log |
| npm run check:sharing | PASS | 3エンジン×日英、共有取消/失敗/コピー拒否/手動選択/PNG失敗、固定URL/hash。共有API/clipboardは模擬。sharing-check-final.log |
| npm run check:history | PASS | 3エンジン×日英、停止/復帰/7件/不正記録除外/非表示時間/フォーカス。history-check-final.log |
| npm run test:daily-preview | PASS | 3エンジン×日英、過去固定URL/hash、manifest/時計変更と通信断完遂、遅延練習、cache再検証、破損停止、410/404。アセット先置き→manifest rename→過去URL保持→復旧。daily-preview-final.log |
| 隔離したreviewerビルド/チェック | PASS | evidence内のビルドをチェック専用サーバーへ接続。候補UI/未完了/JSON書出し/在庫/3エンジン/使い捨てCLI取込。実台帳不変。reviewer-build.log、reviewer-check.log |
| npm run test:server / test:reviewer-server / test:review-https | PASS | 各native境界試験1件。server.log、reviewer-server.log、review-https.log |
| Python参照単独実行 | PASS | 8件。reference-python.log。数学的参考で製品/実機受入の代用ではない |
| Prettier対象コード / git diff --check | PASS | lint専用scriptなし。prettier.log、差分の空白検査 |
| 実URL smoke/画像/性能参考値 | PASS | local-smoke.json、fixed-completed-390.png、share-local-390.png、daily-playing-390.png |

時計境界は59,999/60,000/60,001ms。画面幅は320/375/390/768/1280/1440、短い320/390×568も自動検証。性能はデスクトップChromiumの回転click dispatch→次requestAnimationFrameの30標本でp95約17.4ms。入力装置→実画面描画全体やスマートフォンのp95は未測定。音はなし、reduced-motion時の完成animationはnoneを確認。

## 指示書の受入IDとの対応

以下のPASSは上記環境の自動試験/ローカル候補に限定する。同じ項目でも正式日次の一般公開受入や実機受入を含めない。

| 新ID | 旧受入ID | 状態 | 期待/確認した範囲・手順・証跡 |
|---|---|---|---|
| C01–C03 | G-01/G-02/G-03 | PASS | 個数/連結/座標/ID/ルール検査、回転4回、対称重複/鏡像の区別。core.test.ts、check-final.log |
| C04–C07 | G-03/G-04/G-05 | PASS | 無効配置は不変、移動/取消、2つの別合法解も完成。core.test.ts、E2E |
| I01–I05 | U-01/U-02/U-05/G-05 | PASS | タップ/ドラッグ/キーで完遂、cancel/キャプチャ喪失/別pointer、6幅/44px。E2E |
| I06 | T-06 | NOT_RUN | 言語・サイズの既存自動範囲は確認。実物端末の画面回転と全フラグ維持は未実施 |
| I07 | U-08 | PASS | 本番と別の任意練習、開始前の本番盤面非表示。E2E |
| T01–T03 | T-01/T-02/U-07 | PASS | 60秒継続/ms境界、非表示タイム/バッジ/共有/画像。単体/E2E/共有 |
| T04/T05 | T-03/T-06 | PASS | 手動/visibility/再読込で隠して停止・明示再開、時計変更はuncertain。全スリープ検知の保証なし |
| T06–T08 | T-04 | PASS | 取消は元run、確定はabandoned＋練習、初回不変、完了保存1回。E2E/単体 |
| P01/P04 | T-04/T-05 | PASS | v1読込と任意履歴、再読込取消で時間/ヒント/中断を保持。core/storage単体、E2E |
| P02/P03 | T-05 | PASS | 拒否/容量超過/隔離失敗/破損/未知版/hash、正常な別記録と原本を保全。単体/E2E |
| P05/P06 | T-07 | PASS | 同時claim、Web Locks/IndexedDB引継ぎ、イベント遅延下の旧token拒否、排他不可時の練習。E2E |
| P07 | T-04/T-05 | PASS | 181問整理でfirst marker保持、明示消去でONEBOXだけ。storage単体/E2E |
| H01–H05 | T-04/G-06/U-01 | PASS | 誤配置→戻す助言、未配置ゴースト、取消してもcount維持、上限/起動失敗/古い応答拒否、解答確認/取消。単体/E2E |
| D01/D04–D07 | S-01/S-03/S-07/O-02 | PASS | 固定版＋合成日次previewの日英/時差/過去URL/hash/404/410/通信断。release/共有/daily-preview各ログ |
| D02/D03 | S-02/T-06 | PASS | localhostの公開manifestを正とし、進行runを更新/端末時計で変更しない。daily-previewログ |
| D01–D06 正式配信 | S-01〜S-07/O-02 | BLOCKED | 品質30問/人間試遊と公開権限が不足。実際の日次公開/定時更新は未実施 |
| S01–S04 | S-04〜S-06 | PASS | 固定practiceと合成日次結果、時間非表示、解答/個人IDなし、失敗代替。実OS投稿の証跡ではない |
| Q01–Q03 | G-06/G-07/G-08 | PASS | unique/0/multiple/inconclusive/invalid、幾何学重複、30fixtureと負例の独立Python照合。単体/参照ログ |
| Q04 | P-01〜P-03 | BLOCKED | 実候補5、人間報告0、承認0、有効公開待ち0/必要30。daily-status.json/stock.json。合成を取込まない |
| Q05 | O-01/O-08 | PASS | 固定候補allowlist/秘密/未来未列挙JSON/欠損/サイズ/ソースマップなし。build/配信境界ログ |
| Q06 | O-02/O-04 | PASS | localhostの一時コピーで切替/復旧と過去URL/hash維持。正式publish/rollbackは未実施 |
| U01–U05 | U-03/U-04/U-06/P-01/P-02 | BLOCKED | 実物iPhone/Android/デスクトップSafari/Chrome/Firefox、VoiceOver/TalkBack、実OS共有、未経験者の試遊待ち。下記手順で本人/協力者が実施 |
| O01 | O-01/O-08 | PASS | ONEBOX内だけ変更。公開release/実台帳は不変。safety比較とgit差分 |
| O02 | O-03/O-05/O-06 | NOT_APPLICABLE | 初版は任意集計を不採用。collector未実装を停止試験済みと扱わない |
| O03 | 全体 | PASS | 型/単体/build/書式/native/ブラウザーは最終ログ参照。lint専用scriptなし |
| O04 | O-07/P-05 | PASS | 今回promote/DNS/課金/外部ジョブ有効化/投稿なし |

## 起動・操作

固定修正版（このPCのloopback専用、今回起動/HTTPSではないHTTPを実確認）:

```sh
npm run build:playtest
ONEBOX_SERVE_ROOT="$PWD/dist-playtest" ONEBOX_PORT=4326 npm run serve:playtest
```

- http://127.0.0.1:4326/ja/ 、http://127.0.0.1:4326/en/
- http://127.0.0.1:4326/ja/p/playtest-fixed-v1/ （英語は/en/p/playtest-fixed-v1/）
- タップ: ピース選択→回転→盤面の左上基準→置く。配置済みを選択→移動/戻す/取消。
- ドラッグ: 掴んだセルを保持して離す。盤外/cancelは元のまま。
- キー: Tab/Spaceで選択→盤面をfocus→矢印/R/Enter/Esc。
- 途中で再読込するとpaused。続きを遊ぶ→取消で履歴を確認。2タブ目の明示引継ぎ、完成後の共有確認/コピー/画像も試せる。

合成日次シミュレーション（実公開受入済み問題ではない）:

```sh
npm run build:daily-preview
npm run test:daily-preview
npm run serve:daily-preview
```

http://127.0.0.1:4327/ja/ 、/en/、固定 `/ja/p/onebox-2026-10-16/` と `/ja/p/onebox-2026-10-17/`。合成2版の日付を明記。`evidence/daily-preview`は公開対象外で、既存promoteはdaily manifestを拒否する。停止は起動したターミナルのCtrl+C。今回作ったloopbackサーバーは再起動/自動起動の設定をしていない。

## 未完了・本番の状態・戻し方

- 実台帳はrevision1/候補5/人間報告0/承認0/公開待ち0。`npm run daily -- status` は `blocked_by_quality_stock`（ready0/required30/publication_implemented:false）。人間の補助なし完遂、操作迷い、未完了、ヒント、難易度、端末/支援技術/実OS共有を実測する必要がある。従来の実機「最初の1ピースを置けた」を一問完遂へ格上げしていない。
- 正式日次の公開commit、実公開履歴/withdrawal、180件を超えて保持する全過去アーカイブ、問題を横断する直近7回履歴、進行中を差し替えず新規の今日入口を再取得する更新通知/自動再検証は未完了。現在のdaily-previewは新規ナビゲーション/再読込でmanifestを取得する。固定版の最近7回は既存実データのまま。
- 定時主系はMacの専用1系統を候補とし、状態確認だけの未インストール設定例をOPERATIONSへ記載。実際の定時公開ジョブは無効/未実装。物理停止/再起動/LAN CA/実物スマホのprivate HTTPS接続、複数外部地点、継続観測は今回未実施。
- 実物Safari等での操作・画面回転、VoiceOver/TalkBack、実入力→描画p95、ゲームの楽しさ/難易度は自動試験で代替しない。現時点で確認された未修正の不具合と最終試験の成否は末尾の確定結果を参照。
- **今回の修正版は本番未反映。** 配信symlinkは既存m1-9f3ad077ead7、digest9f3ad077ead78154c912938b743e51de97fbb3ad6e969e1f1de4a5c01bc1e1b2のまま。本番HTTPSの開始/完遂は今回再検証していない。既存サービス/公開ファイル/DNS/トンネル/LaunchAgent/課金は変更なし。
- 保存v1へ任意フィールドを追加しただけで一括移行/削除はなし。旧記録に存在しない取消履歴は復元できない。終端初回記録は不変で、表示設定を別に保持する。通常整理でfirst markerを消さない。クラッシュ直前の未保存区間・ブラウザーデータ消去・quotaからの完全復旧は保証しない。
- 旧UIへ戻してもv1記録は読めるが、新しいundo_historyを旧UIで更新すると取消履歴を保持できない場合がある。手動で戻す前に対象ONEBOXキーを退避する。破損時はquarantineを確認し、localStorage.clearや全体resetで直さない。コード変更は未コミットでレビュー可能に残し、reset/clean/強制pushをしていない。

## 変更ファイル

- `README.md`
- `SPEC.md`
- `TASK.md`
- `apps/web/src/App.tsx`
- `apps/web/src/PublishedApp.tsx`
- `apps/web/src/RecentAttempts.tsx`
- `apps/web/src/ShareResult.tsx`
- `apps/web/src/i18n.ts`
- `apps/web/src/lease.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/storage.ts`
- `apps/web/src/style.css`
- `docs/ACCEPTANCE.md`
- `docs/DATA_CONTRACTS.md`
- `docs/GAME_RULES.md`
- `docs/OPERATIONS.md`
- `docs/REVISION_PLAN_20261017.md`
- `docs/REVISION_REPORT_20261017.md`
- `docs/UI_SPEC.md`
- `package.json`
- `packages/game-core/core.test.ts`
- `packages/game-core/index.ts`
- `packages/game-core/release.test.ts`
- `packages/game-core/release.ts`
- `packages/game-core/sharing.test.ts`
- `packages/game-core/sharing.ts`
- `packages/game-core/storage.test.ts`
- `scripts/build-daily-preview.mjs`
- `scripts/check-daily-preview.mjs`
- `scripts/check-history.mjs`
- `scripts/check-reviewer.ts`
- `scripts/check-sharing.mjs`
- `scripts/daily-preview-server.mjs`
- `tests/e2e/play.spec.ts`

## 最終確定結果

最終コードを固定して型・単体67件・E2E126件をPASS（42項目×Chromium/Firefox/WebKit、2.3分）。最終の固定候補で配信異常/日英共有/履歴、合成日次切替/復旧、隔離した候補試遊を再確認。途中の失敗は修正済みで、確認した自動試験/ローカル候補の範囲に未修正の再現不具合は残っていない。実機や未実装の日次正式運用まで無不具合を保証した意味ではない。

最終固定候補digestは `0668be7e8dae8d80bc63a4252cfb181b5f3573e493484b544090510bdeee8624`、圧縮JS+CSS+Worker合計91,732 bytes。固定payload hashは従来どおり `b30042deab13615c3fb6c3c1082f7d457607ee9e0ffa82ba077d416f5406c9b3`。最新スクリーンショット/性能参考値はこの候補から再取得（local-smoke.json）。

source-hashes.json/source-verification.txtで検証中のコード不変を確認。safety-before-final.jsonとsafety-final.jsonで公開releaseのsymlink/digestと実台帳revision/digest/5候補が不変であることを確認。既存保存の一括削除、実人間報告の作成、他アプリ変更、公開/外部ジョブの操作なし。

到達点は「固定問題のローカル修正版を自動検証」「日次の独立したローカル検証コードまで」。次は実機・人間試遊と品質承認を行い、その証拠を得てから正式日次の公開commit/アーカイブ/横断履歴/更新通知/定時ジョブ/HTTPS受入へ進む。今回の本番公開は未実施。

## 追加依頼: 「友達に送る」を「Xに投稿」へ変更

結果の主ボタンを「Xに投稿 / Post to X」に変更。内容確認ダイアログの主リンクが、解答なしの既存結果文と当該固定URLをXの投稿画面へ渡す。新しいタブはnoopener/noreferrer。X側で利用者が投稿を確定し、ONEBOXで投稿済みと表示しない。OS共有・コピー・手動選択・画像保存は維持。外部SDKや自動投稿/APIを追加せず、保存形式と初回記録にも変更なし。

今回の変更対象はShareResult.tsx、style.css、game-core/sharing.ts、共有/日次preview検査のセレクターとX遷移検査、SPEC/TASK/UI_SPECとこの報告の追記。前回までの未コミット変更を保持している。

今回の検証: `npm run check`（型・単体67件・build）、`npm run build:playtest`、`npm run check:sharing`（日英×3エンジン、X投稿画面をローカル応答で模擬、text/url/非表示時間/新規タブ/コピー/画像等）、`npm run build:daily-preview` / `npm run test:daily-preview`（日英×3エンジン）、変更コードのPrettier、`git diff --check` がPASS。前掲のE2E126件は前回修正時の証跡であり、この小変更では共有/日次の対象ブラウザー検査を再実行した。

証跡: `evidence/x-post/check.log`、`sharing.log`、`daily-preview.log`、各buildログ、`prettier.log`、`preview-390.png`。固定候補digestは `bbd223e86427f7dd5d55ff6bbdd6beba7c80056083d9b54adcfa99933efd56ca`、gzip91,907 bytes。今回の追加変更により、前掲source-hashes.jsonは前回時点のコードの証跡となる。

http://127.0.0.1:4326/ja/p/playtest-fixed-v1/ で完成→X投稿内容確認を実確認した。日次のlocalhost4327も再ビルド済み。本番symlinkは従来のm1-9f3ad077ead7のままで、今回も公開反映なし。実際のXへの接続/ログイン/投稿、実物端末のXアプリ引継ぎは未実施。テストで実投稿もしていない。


## 継続許可と本番反映の記録

ユーザーの「修正した後は常に本番に反映していいよ」を根拠に、修正指示書による一時的な本番反映禁止を解除した。AGENTS/SPEC/TASKと運用手順へ、今後は修正→検証→同じ成果物を本番反映→HTTPS確認まで行う方針を記録。新規課金・破壊操作・他サービスへ影響するDNS/インフラ変更の別確認、実機/人間/品質ストックのゲートは維持する。

検証済み固定practiceのdigest `bbd223e86427f7dd5d55ff6bbdd6beba7c80056083d9b54adcfa99933efd56ca` を再ビルドせず `npm run promote:playtest -- <digest>` で反映した。新releaseは `m1-bbd223e86427`、previousは `m1-9f3ad077ead7`。今回の一連の入力/保存/時計等の修正とX投稿導線を含む。合成日次preview/未承認候補/保存解を公開していない。公開問題ID/rules/hashは従来どおり。常駐web/tunnelのPIDも維持し、再起動・設定/DNS変更なし。

公開URL:
- https://onebox.formflow-ops.com/ja/
- https://onebox.formflow-ops.com/en/
- https://onebox.formflow-ops.com/ja/p/playtest-fixed-v1/
- https://onebox.formflow-ops.com/en/p/playtest-fixed-v1/

`check:playtest -- <HTTPS origin>`、`node scripts/check-release.mjs <HTTPS origin>`、`check:sharing -- <HTTPS origin>`、`check:history -- <HTTPS origin>` がPASS。実際のHTTPS/Chromium156で日英トップの開始・ヒント・タップ完遂/保存、固定URL/hash、X内容確認と模擬投稿画面/コピー/画像、履歴、破損/通信失敗時の開始停止と再試行を確認。共有先/Xログイン/実投稿は模擬のままで、実物スマートフォン等の受入を代替しない。

現在/旧release全assetsはHTTPSで200かつローカルhash一致。manifestとpayloadも照合し、private候補/API/reviewer専用assets/合成日次URLは404。実台帳と共用Cloudflare設定のhashは反映前後で不変。既知の共用zoneタグ挿入は従来どおりCSPで実行を遮断しており、完全な非挿入を達成したとは扱わない。

証跡は `evidence/x-post-production/` のbefore.json、promote.log、playtest-public.log、release-public.log、sharing-public.log、history-public.log、boundary.json。変更ファイルはAGENTS.md/SPEC.md/TASK.md/README.mdと本報告・運用文書。製品コードは直前の検証済み成果物と同一で、未コミットの既存作業を保持した。正式日次/品質30問/人間・実機受入は引き続き未完了。
