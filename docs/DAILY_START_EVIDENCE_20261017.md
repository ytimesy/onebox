# 日次の新規開始前の再確認（2026-10-17）

ユーザーの「実装を続けて」に対応。既存の仕様・ソース・テスト・未コミット差分を確認し、開始前の画面を開いたまま配信が変わった場合に、新規開始の直前では確認し直していない不足を修正した。過去問/復旧の調査から見つけた開始待ちの競合を先に扱い、全過去アーカイブや品質受入を完成扱いにしていない。新規アプリへの置換は行わない。

## 変更ファイルと動作

| ファイル | 変更 |
| --- | --- |
| apps/web/src/daily-start.ts（新規） | 新規開始用のmanifest再取得。no-cache、1MB、10秒期限、stage/掲載/撤回/同じIDのメタデータ・hash/時刻逆行を検査。既知の撤回が消えたmanifestも拒否 |
| apps/web/src/PublishedApp.tsx | 日次previewの開始前確認を接続。最新の確認状態を画面へ反映し、ページ読込時もキャッシュに残る既知の撤回情報を失わない。固定playtestは日次確認へ接続しない |
| apps/web/src/App.tsx | 入力直後から準備中とし、確認中はrunを作らず、結果に応じて練習/開始拒否を選ぶ。消去/所有権喪失/終了で確認を中断。確認待ちを時計へ加算せず、再開の通信を必須にしない |
| packages/game-core/daily-start.test.ts（新規） | 開始判定、掲載終了・撤回、内容変更、時刻/撤回情報の逆行、通信/5xxと不正/4xxの区別、キャンセル、期限の8件 |
| scripts/check-daily-start.mjs（新規）、package.json | 合成日次を使う日英×3ブラウザーの36ケース、check:daily-start起動コマンド |
| SPEC.md、TASK.md、docs/DATA_CONTRACTS.md、UI_SPEC.md、OPERATIONS.md、本書 | 開始待ちの仕様、保存境界、操作/起動手順と未完了を記録 |

初回/練習の判定、端末内保存v1、問題ID/hash/rules、ゲームコア・完成判定は再利用した。新規runの直前だけ確認し、既存の進行中/一時停止runの再開では同じrunを維持する。撤回が確認された場合は新規開始と結果共有を止め、完成済み初回結果は書き換えない。

トップのactiveが変わっても画面の問題を差し替えず、元の問題での新規開始は練習とする。公開中の問題を確認するリンクを選んだ場合だけ新問へ移動する。過去の固定URLは元の問題を保持する。応答受信前のネットワーク失敗/5xx/タイムアウトなら、既に検証済みの同じ問題を練習として使える。不正/読み切れない応答・4xxではキャッシュで隠さず開始を止める。

確認中には新しいrun/初回識別を書かず、短い保存mutationロックを通信待ちへ持ち越さない。記録消去や画面終了で要求を中断し、遅い返答が古い世代の記録を作らない。端末時計から今日の問題や公式スコアを決めない。

## 検証

証跡は `evidence/daily-start-20261017/`。日次異常注入は一時ルート・空きloopbackポート・専用ブラウザーだけへ行い、実台帳/本番へ送らない。

| コマンド | 確認内容 | 証跡 |
| --- | --- | --- |
| npm run check | 型/単体103件・13ファイル/build/公開アセットallowlist成功 | check-final.log |
| npm run test:e2e | ソース固定後の新規4320/1 workerで3ブラウザー126件成功 | e2e-final.log |
| npm run build:daily-preview | localhost限定の合成2版を再構築 | build-daily-final.log |
| npm run check:daily-start | 日英×3ブラウザー・36ケース成功 | browser-final.log、browser-results.log |
| npm run test:daily-preview | 日英×3ブラウザーの過去固定URL/通信断/共有/複数問履歴/切替・復旧成功 | daily-regression-final.log |
| npm run check:daily-lifecycle | 日英×3ブラウザーの複数日/遅延/全問撤回/新問再開成功 | lifecycle-regression-final.log |
| npm run build:playtest | 固定版の生成・型・公開境界成功 | build-playtest.log |
| node scripts/check-release.mjs | 固定候補の3ブラウザー、manifest/JSON/hash/異常拒否/明示再試行、生成物の不足・余分payload拒否成功 | release-candidate.log |
| npm run check:history / check:sharing | 固定候補の日英×3ブラウザー成功。X画面/clipboard等は模擬 | history-candidate.log、sharing-candidate.log |
| npm run daily -- status | revision1、ready0/required30、blocked_by_quality_stock | real-stock.log |
| Prettier / git diff --check | 成功 | 最終コマンド出力 |

追加の6シナリオを各言語・ブラウザーで検査した。

1. 開始前のトップ更新で古いID/hashを保持し練習になる。4秒の確認待ちを時計へ入れず、新問へのリンクを選んで新しいIDの初回を開始する。
2. 開始前の撤回はrun/初回識別を作らない。古いmanifestの再取得・通信断・ページ再読込で既知の撤回を失わない。
3. 4xx/不正JSONを拒否し、明示再試行で初回を正確に1回作る。
4. 通信失敗を表す503では同じ検証済み問題だけ練習で開始する。
5. 進行中の初回は撤回をまたいでも通信断で再開・完遂する。その後の練習開始が撤回で拒否されても完成済み初回を変更せず、共有導線を隠す。
6. 開始前確認中の記録消去が遅い返答を無効化し、その後の明示開始だけがrunを作る。

320/390/768/1440pxの横はみ出しと新リンクの44px以上を確認した。updated-ja.pngを目視でも確認。36ケースのpageerrorは0件。これは自動ブラウザーの証跡で、人間の試遊・実物端末・OSへの投稿完了ではない。

途中の失敗ログも保持する。browser-first.log/browser-second.logでは、開始処理の初期段階でボタンがまだ準備中にならず、前回の失敗表示を残したまま再試行できる隙間を検出した。入力直後から処理中にし、確認/失敗表示を開始ボタンより下へ移して位置を安定させた。browser-third.logの一時停止ボタン待ちは、テストが装飾文字付きの実際のボタン名を完全一致で探した誤りで、セレクターを修正した。英語の既存ラベルと保存キーの参照も実装に合わせた。

初回E2Eは124件成功/2件失敗。開発サーバーのソース更新と同時期に、タッチ中のDOM差替えと別タブ競合表示の待ちが失敗した。原因をHMRだけと断定せず、ソースを固定して全126件を再実行した。初回ログはe2e-initial.logに保持し、最終結果と区別する。

## 起動手順とURL

```sh
npm run build:daily-preview
ONEBOX_START_EVIDENCE=evidence/daily-start-20261017 npm run check:daily-start
npm run serve:daily-preview
```

通常の日次ローカルUIは http://127.0.0.1:4327/ja/ と /en/。追加検証では毎回新しいサーバーを起動/終了し、既存4327やreviewer4324/LAN4325のプロセスを止めない。実在庫の確認は `npm run daily -- status`。

固定候補の起動は `npm run build:playtest` の後、`ONEBOX_SERVE_ROOT=dist-playtest ONEBOX_PORT=4326 npm run serve:playtest`。既存の同じONEBOXサーバーが動いていれば重複起動しない。公開URLは https://onebox.formflow-ops.com/ja/ と /en/、固定URLは /ja/p/playtest-fixed-v1/ と /en/p/playtest-fixed-v1/。

## 境界と残件

公開中は固定1問の試遊版。正式日次は未公開。実在庫は候補5/人間報告0/承認0/有効公開待ち0、必要30問。今回も自動承認、実台帳への合成試遊報告取り込み、定時ジョブ有効化を行わない。既存未コミット変更と保存データを保持し、他アプリ/DNS/課金/共用設定を変更しない。

全過去アーカイブ、180問を超えた固定URLの保持、正式日次commit/実台帳の接続、公開後の実レビュー再確認手順、品質30問の受入は残る。今回の開始前確認で全過去アーカイブができたとは扱わない。確認後の同時撤回や通信不能時の未知の撤回を即座に認知する保証もない。sessionStorageの消去/拒否や別セッション/端末を越える失効保証はない。

実物iPhone/Androidの一問完遂・ドラッグ/スクロール、VoiceOver/TalkBack、OS共有、人間の難易度/初回配置、スマートフォン側の非公開CA設定、PC物理停止/再起動復旧は未確認。以前の日次異常注入で一度だけ発生したaccess-control pageerrorも原因未特定。自動試験を実機/人間の受入へ数えない。次はこれらの品質/実機確認と、非公開の過去問保持・復旧の実装を進める。

## 最終確認・反映

最終の型/単体103件・13ファイル/build、fresh E2E126件（2.3分）、新規開始前確認36ケース、既存日次6フロー・撤回復帰6フロー、固定候補の日英×3ブラウザーの共有/履歴/配信整合が成功した。初回失敗の2件もソース固定後の全体再実行で成功した。過去の単発pageerrorの原因が解明したという意味ではない。

ブラウザーで確認した同じ固定版digest `87ec25e1e692cbb20d9457e653b132fde68474eca22137ae6cf3e98e9c5cce97` を `npm run promote:playtest -- <digest>` で `m1-87ec25e1e692` へ反映。前版 `m1-0ed6dbe1cf26` はpreviousに保持した。固定問題hash `b30042deab13615c3fb6c3c1082f7d457607ee9e0ffa82ba077d416f5406c9b3` と保存v1/rulesは維持。JS/CSS/Workerのgzip合計93,551 bytes。合成日次/台帳/未来候補をこの生成物へ入れていない。

`npm run check:playtest -- https://onebox.formflow-ops.com`、`node scripts/check-release.mjs https://onebox.formflow-ops.com`、`npm run check:sharing -- https://onebox.formflow-ops.com` が成功。HTTPSの日英で開始/ヒント/タッチ完遂/練習/保存/4幅、manifest/JSON/hash/固定URL、異常拒否/明示再試行、X投稿内容確認/コピー/画像を確認した。共有先とclipboardの成否は模擬で、実OS共有・Xへの実投稿を完了扱いにしない。各*-public.logに記録。

日英トップ/固定URL/healthは200、新旧全8 assetsはHTTPS200と内容hash一致。候補/在庫API、検証領域、snapshot.PRIVATE、日次ツールのソース、追加fixture、合成日次URLは404。既存のlocalhost4326固定候補と4327の日英は200（public-boundary.json）。通常の証明書検証を使い、共有CSPで既知のedgeタグ実行が遮断されることを確認した。タグ自体の非挿入の確認とは区別する。

実候補/台帳等private全20ファイルは前後でdigest `dbf5e5d9a78549e090b0e133bafb0c23d331a9499b969cc56cfaa71356ec959c` が一致（before.json/after.json）。実在庫revision1/ready0/required30を維持。既存未コミット変更・保存データは保持し、Git commit/push、常駐サービスの再起動、DNS/課金/外部ジョブ有効化、他アプリ変更は行っていない。公開は固定1問のままで、M1実機/T22品質30問/M3正式日次/M4正式受入は未完了。
