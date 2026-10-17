# 日次の複数日・撤回・再開の非公開検証（2026-10-17）

ユーザーの「どんどん進めて」に従い、既存の固定版、日次preview、コピー台帳の原子的snapshotを拡張した。既存の未コミット変更を保持し、新規アプリへの置換や実台帳の承認は行っていない。仕様差分はSPEC.md末尾、非公開の操作手順はOPERATIONS.md末尾。正式日次の受入は未完了。

## 変更内容とファイル

| ファイル | 変更・再利用 |
| --- | --- |
| packages/game-core/release.ts | 共通manifest検査を再利用し、日次だけに全問撤回unavailableを追加。純粋関数recallDaily/delayDailyで最新の利用可能問への退避、非逆行時刻、再実行を検査 |
| apps/web/src/PublishedApp.tsx | 全問利用停止を日英表示し、明示再確認から新問へ戻す。固定playtestのstage/hash検査は維持 |
| apps/web/src/style.css | 撤回ページのトップリンクを44px以上にする。既存Xリンクのスタイルを共用 |
| packages/puzzle-tools/daily-rehearsal.ts | 複数日の履歴保持、遅延/撤回/コピー台帳の明示再読込、担当・理由のPRIVATE記録。既存writer/head/不変snapshot/原子的切替を共用 |
| packages/puzzle-tools/daily-cli.ts | recall-rehearsal/delay-rehearsal/refresh-rehearsalを追加。元台帳は読み取りのみで、本番のvar/currentは対象外 |
| scripts/daily-preview-server.mjs | loopback検証用。全問撤回トップ503、撤回固定URL410と日英トップリンク、撤回payload404 |
| packages/game-core/release.test.ts、public-cache.test.ts | 撤回/利用停止の検査、固定URL選択、既存キャッシュの除外を検証 |
| packages/puzzle-tools/daily-lifecycle.test.ts、daily-rehearsal.test.ts | 複数日/遅延/撤回/再開、不正な再読込・古いhead・検査失敗、実Node CLIを検証 |
| tests/helpers/quality-catalog.ts、daily-lifecycle.ts、tests/fixtures/daily-extra.json | 使い捨て32問の合成台帳を構成。レビュー更新はテスト専用の明示操作。PRIVATE解答をfixtureへ入れない |
| scripts/check-daily-lifecycle.mjs、package.json | 日英×3ブラウザーの追加検証とcheck:daily-lifecycle起動コマンド |
| SPEC.md、TASK.md、docs/DATA_CONTRACTS.md、UI_SPEC.md、OPERATIONS.md、本書 | ready/delayedからの契約追加、その理由、検証範囲と未完了を記録 |

全問撤回でもactiveの識別情報は非プレイ用に保持する。unavailableはactiveを含む全recentの撤回を要求し、選択関数は新規開始を許可しない。新manifestを取得すると対象キャッシュを除外するが、端末内runや初回識別は消さない。既に開いたrunは元の問題/hash/初回状態を保ち、通信断でも完遂できる。まだ取得できていない撤回を通信不能時に知る保証はない。

コピー台帳の再読込はrevision増加、同じ公開履歴、候補ID/問題/以前のイベント・試遊記録の保持を要求する。公開後のレビューは自動更新せず、次のprepare/commitでも現行レビューと30問条件を再検査する。公開計画の再実行で撤回を取り消すことはできない。旧snapshotと履歴は残す。

## 実行と結果

証跡は `evidence/daily-withdraw-20261017/`。公開操作と異常注入を分け、異常manifestは使い捨てloopbackサーバーにだけ送った。

| 実行コマンド | 結果 | 証跡 |
| --- | --- | --- |
| npm run check | 型検査、単体95件/12ファイル、build、公開アセットallowlist成功 | check-final.log |
| npm run test:e2e | 毎回新規4320、Chromium/Firefox/WebKitの126件成功 | e2e.log |
| npm run build:daily-preview | 成功。実在庫・公開releaseには接続しない | build-daily.log |
| node scripts/check-daily-lifecycle.mjs | 日英×3ブラウザーの6フロー成功。実際に作ったLOCAL snapshotから配信 | browser.log、lifecycle.log、unavailable-ja-390.png |
| npm run test:daily-preview | 日英×3ブラウザー、過去URL/複数問履歴/通信異常/撤回/切替・復旧成功 | daily-regression.log、regression/ |
| npm run build:playtest | 固定版の公開allowlist検査成功 | build-playtest.log |
| node scripts/check-release.mjs | 固定候補の3ブラウザー整合/異常拒否/明示再試行、生成物の不足・余分payload拒否成功 | release-candidate.log |
| npm run check:history / check:sharing | 固定候補の日英×3ブラウザー成功。共有先・clipboardは模擬 | history-candidate.log、sharing-candidate.log |
| npm run daily -- status | revision1、ready0/required30、blocked_by_quality_stockを維持 | real-stock.log |
| Prettier / git diff --check | 成功 | 最終コマンド出力 |

追加6フローで、2日分の固定URL/hash保持→遅延→現在問撤回/過去問の練習→全問撤回/503と再確認/キャッシュ除外→受入済み新問で復帰を確認した。撤回固定URL410、問題JSON404、320/390/768/1440px、既存runの通信断での初回完遂、撤回run原本の保持と新履歴からの除外、新問の初回完遂を検査した。pageerrorは0件。将来問題/PRIVATE snapshot/候補APIも非公開のまま。

準備中の失敗はtargeted.logに残す。追加テストの構文誤りと、合成レビュー更新の順序依存を修正した。合成レビューでは対象をいったん全て再確認状態へ戻してから順に検査する。製品側の品質条件を緩和したり、mainへ合成報告を入れたりしていない。今回の試験を人間の品質評価や実物端末の確認として数えない。

## 起動手順と確認URL

```sh
npm run daily -- status
npm run build:daily-preview
ONEBOX_LIFECYCLE_EVIDENCE=evidence/daily-withdraw-20261017 npm run check:daily-lifecycle
npm run serve:daily-preview
```

通常の合成日次UIは http://127.0.0.1:4327/ja/ と /en/。既存待受を停止しない。今回の既存4327は日英200のみ確認し、プロセスを再起動していない。追加の撤回/503/再開検証は毎回新規の一時ルートと空きloopbackポートで実施し、作成したサーバーと領域だけを終了/削除した。固定候補 http://127.0.0.1:4326/ja/ も200。

固定版のローカル起動は `npm run build:playtest` の後に `ONEBOX_SERVE_ROOT=dist-playtest ONEBOX_PORT=4326 npm run serve:playtest`。既に同じONEBOXサーバーが動いている場合は再起動不要。未承認候補の4324/4325や合成日次を公共トンネルへ接続しない。

## 本番反映と保存

検証済みの同じ固定版digest `0ed6dbe1cf26035a8157b9108bcb8b15307185c665c21c78f702efeeab59c830` を `npm run promote:playtest -- <digest>` で `m1-0ed6dbe1cf26` へ反映した。前版m1-3ad0d6ed4161をpreviousに保持。固定問題IDとhash、rules、端末内保存v1を維持し、旧assetsも残した。JS+CSS gzip92,945 bytes。サービスの再起動、DNS/課金/外部ジョブ有効化、他アプリの変更なし。

公開URLは https://onebox.formflow-ops.com/ja/ と /en/。固定URLは /ja/p/playtest-fixed-v1/ と /en/p/playtest-fixed-v1/。`npm run check:playtest -- https://onebox.formflow-ops.com`、`node scripts/check-release.mjs https://onebox.formflow-ops.com`、`npm run check:sharing -- https://onebox.formflow-ops.com` が成功した。HTTPSの日英で開始/ヒント/タッチ完遂/練習/保存/4幅、固定URL/manifest/JSON/hash、破損拒否/明示再試行、解答なし共有を確認。Xへの実投稿やOS共有先の確認ではない。

health/日英トップ/固定URLは200。新旧全8 assetsのHTTPS200/hash一致。合成日次URL、追加fixture/日次ツールのソース、snapshot.PRIVATE、候補/在庫API、検証領域は404（public-boundary.json）。通常の証明書検証を使った。既知の共用edgeタグ挿入はCSPで遮断され、今回も実行/追跡Cookie/analytics応答は観測していない。タグ自体の非挿入を完了扱いにしない。

実台帳などprivate全20ファイルは変更前後のdigest `dbf5e5d9a78549e090b0e133bafb0c23d331a9499b969cc56cfaa71356ec959c` が一致（before.json/after.json）。テストの固有workspaceだけを掃除し、既存の保存データ・候補・未コミット変更は保持した。Gitへのcommit/pushは今回行っていない。

## 残件と次の作業

正式日次は未公開で、公開中は固定1問の試遊版。実台帳は候補5、人間報告0、承認0、有効公開待ち0/必要30問。次の優先は非公開の人間試遊と品質受入、公開履歴更新後の実レビュー再確認、正式日次commit/実台帳/全過去アーカイブの接続。定時ジョブは無効のまま。複数日・撤回の非公開成功を正式配信の実績へ読み替えない。

実物iPhone/Androidでの一問完遂・ドラッグ/スクロール、VoiceOver/TalkBack、実OS共有、人間の難易度/初回配置観察は未完了。ユーザー確認済みは最初の1ピース配置まで。CAを含むスマートフォン側の非公開試遊設定は本人の操作待ち。PCの物理停止/再起動からの復旧・複数地点確認も未完了。

以前の日次異常注入で一度だけ発生したaccess-control pageerrorは今回も未再現で原因未特定。今回の自動検証で残る再現性のある不具合は検出していないが、実機受入を代替しない。日次公開/品質30問/M1実機/M4正式受入を完了へ変更しない。
