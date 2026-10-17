# 180問超の過去問保持と本番稼働確認（2026-10-17）

ユーザーの「実装を進めて、それから、本番も起動して」に対応。AGENTS/SPEC/TASK、既存ソース/テストと未コミット差分を確認し、直近180問のPRIVATE照合履歴と公開済み問題のアーカイブを分けた。本番の専用Webとトンネルは開始時から稼働しており、localhost4321のhealthも正常だった。検証後の固定版反映とHTTPS確認は末尾へ記録する。

## 実装と変更ファイル

| ファイル | 内容 |
| --- | --- |
| packages/game-core/release.ts | 日次だけに任意のarchive参照、PublicArchive、厳密な構造/件数/UTC順序/未来/ID検査とcanonical SHA-256照合を追加。過去固定URLの選択と全アーカイブからの撤回時退避 |
| packages/puzzle-tools/daily.ts | 前回アーカイブと公開件数/hashを照合し、全過去メタデータを保持した計画を作る。ID不変性、30問、独立ソルバーの条件を維持 |
| packages/puzzle-tools/daily-rehearsal.ts | 既存plans/sourcesから公開済みの全JSONを再構成。新snapshotにarchive_version1/索引を追加し、旧snapshotは元のdigestのまま読める。索引と全公開JSONを検査後に原子的に切替 |
| packages/puzzle-tools/daily-cli.ts | previous-nameから完全な前回索引も読む。inspectのarchive_countは新形式の件数、旧形式はnull |
| packages/puzzle-tools/curation.ts | 先行2問を選んでから特徴量を計算。180問全件の幾何学的比較結果を内容hash付きで再利用し、履歴の変更/直接編集時は再計算 |
| apps/web/src/PublishedApp.tsx、daily-start.ts | recent外の固定URLと開始前確認を索引へ接続。取得済み問題の復帰、撤回の優先、同じID/hash/初回結果の保持を継続 |
| apps/web/src/public-cache.ts、public-archive.ts（新規） | 索引を任意キャッシュへ互換追加。再利用時もhash検査。5xx/通信失敗だけ取得済み版へ退避し、4xx/不正/不一致を隠さない |
| apps/web/src/App.tsx、RecentAttempts.tsx | 全公開メタデータから直近7回を検査し、recent外の実runも日付別固定URLで表示。確認中の一時停止と原本保持を維持 |
| scripts/daily-preview-server.mjs | localhost限定で参照索引/公開JSON/過去固定URLを配信。未公開/未来/未参照ファイルは404、撤回URLは410、撤回JSONは404。過去ページのcanonicalも当該固定URLへ設定 |
| packages/game-core/archive.test.ts、packages/puzzle-tools/daily-archive.test.ts（新規） | 索引改ざん/キャッシュ/撤回、旧180件snapshotから182件への保持と切替失敗を検証 |
| packages/puzzle-tools/curation.test.ts、daily-rehearsal.test.ts | 履歴の直接変更でも古い幾何学比較結果を使わない検査、新しい公開ファイル構成、CLI境界を維持 |
| tests/helpers/long-history.ts（新規）、scripts/check-daily-archive.mjs（新規）、package.json | 使い捨て180件履歴から実際のローカル切替で182件へ更新し、日英×3ブラウザーで確認 |
| scripts/check-daily-lifecycle.mjs、check-daily-start.mjs | 索引を先に配置してmanifestを切替。既知の開始拒否を保持する現在の表示に合わせて期待値を更新 |
| SPEC.md、TASK.md、docs/DATA_CONTRACTS.md、UI_SPEC.md、OPERATIONS.md、本書 | 新契約、原仕様の180件制限との役割分離、移行/上限/未完了と起動手順 |

アーカイブ索引には公開済みID/日時/slug/payload hash等だけを含め、元台帳/seed/解答/レビュー/人間報告を入れない。撤回メタデータは索引へ残すが、最新manifestの撤回指定を優先し、対応JSONを提供しない。旧snapshot/旧JSONを消して新しい日次供給を作る方式ではない。

## 検証範囲

証跡は `evidence/daily-archive-20261017/`。180件の過去履歴は、同じ検証済み形状を別IDへ割り当てた境界テスト専用データで、実際の公開履歴/品質受入ではない。元sourceの台帳/PRIVATE形式も使い捨て領域だけに置いた。新しい2問の切替には既存の30問条件と独立Pythonソルバー検査を通し、レビュー更新は明示的な合成テスト操作だけで行った。

182件に更新した後も、直近照合履歴とrecentは180件、索引と全公開データは182件を保持する。最古の固定URL/hash、日英の初回完遂、同じURLの解答なし共有、問題をまたぐ履歴、320/390/768/1440px、取得済み索引での練習復帰、実際の通信断完遂、悪い索引/404の拒否と明示再試行、アーカイブ問の撤回410/JSON404、履歴からの除外と完成済みrun原本保持を確認する。索引破損を切替前検査で検出した場合は旧headを保持する。

古い索引を省略した次の公開計画は拒否する。182件公開後の合成在庫は29問となり、次の計画は30問条件で拒否する。境界テストを通すために人間報告を実台帳へ加えたり、在庫条件を緩和したりしていない。

## 発見・修正した問題と失敗ログ

初期の182件テストは30問条件で停止した。180問すべての特徴量を各レビューで計算して最後に2問を選び、幾何学的比較も毎回全履歴を再計算していたため、在庫確認の3秒上限に達していた。先行2問だけの特徴量計算と、履歴内容hashによる比較結果の再利用へ修正。180問の重複照合は維持し、変更した履歴はキャッシュを使わない。

変更前後に同じ180件履歴の3候補で全チェック出力を比較し、警告/先行特徴量/check_hashが一致した（review-before.json/review-after.json）。review context v2、在庫の3秒上限、1問ごとの探索上限、30問条件は変更していない。

途中のbackend-targeted.log/archive-targeted.log/backend-final.log/browser-diagnostic-first.logを保持する。公開ファイルの構成追加とID再利用時のエラー優先順位を修正し、旧形式との境界検査を維持した。browser-diagnostic-second.logでは、取得済みの完成結果を復元した後にテストが開始ボタンを探していたため失敗した。既存仕様どおり結果復元を確認してから練習を始めるテストへ修正した。start-regression.logは、既知の撤回を再確認不能の一般エラーより優先して保持する新しい表示に合わせ、期待値を更新した。

初回全体check.logは107件成功/2件失敗だった。上記ID再利用のエラー順序と、複数の実Node CLIを起動する既存統合テストの5秒timeoutが原因。ID不変性を先に拒否し、CLI統合テストだけ20秒/子プロセス10秒の上限を明示した。製品の品質/探索/在庫検査の期限は緩和しない。最終結果は末尾のログと区別する。

## 起動・操作手順

```sh
npm run daily -- status
npm run build:daily-preview
ONEBOX_ARCHIVE_EVIDENCE=evidence/daily-archive-20261017 npm run check:daily-archive
npm run serve:daily-preview
```

通常の合成日次UIは http://127.0.0.1:4327/ja/ と /en/。アーカイブの182件シナリオは毎回新しい一時ルートと空きloopbackポートを使い、終了時は作成したサーバー/領域だけを片付ける。既存4327の待受やreviewer4324/LAN4325を止めない。候補APIやPRIVATE領域を公共トンネルへ接続しない。

固定版のローカル起動は `npm run build:playtest` → `ONEBOX_SERVE_ROOT=dist-playtest ONEBOX_PORT=4326 npm run serve:playtest`。既存待受が同じONEBOXサーバーならそのまま使用する。本番は専用LaunchAgents `local.onebox.web` / `local.onebox.tunnel`、配信127.0.0.1:4321。稼働中の専用サービスを維持し、検証済みの同じ生成物をpromoteしてからHTTPSで確認する。

公開URLは https://onebox.formflow-ops.com/ja/ と /en/、固定URLは /ja/p/playtest-fixed-v1/ と /en/p/playtest-fixed-v1/。今回も正式日次ではなく固定1問である。

## 残件・上限

実在庫は候補5、人間報告0、承認0、有効公開待ち0/必要30問。正式日次commitと実台帳/公開主系の接続、公開後の実レビュー再確認手順、品質30問と人間/実機の受入は未完了。定時ジョブは無効のまま。182件の合成履歴を実在庫や正式公開実績へ取り込まない。

過去問保持は非公開の182件境界まで検証する実装で、無制限の長期運用受入ではない。既存の候補台帳500件、snapshot 10MB、索引読込4MB/最大10,000件等の上限がある。上限で黙って履歴を落とさず停止する。長期運用にはsource台帳/索引等の分割管理が残る。キャッシュ上限1,100,000文字を越える保存や、通信不能時の未知の撤回の認知も保証しない。

実物iPhone/Androidの一問完遂・操作、VoiceOver/TalkBack、実OS共有、人間の難易度評価、非公開スマホ側CA設定、PC物理停止/再起動/ログインからの復旧、複数地点の確認は未完了。以前の単発access-control pageerrorの原因調査も残る。共有先APIの模擬成功や自動ブラウザーを人間/実機の受入へ数えない。

## 最終結果と本番反映

| 実行コマンド | 最終結果と証跡 |
| --- | --- |
| `npm run check` | 型検査、109件/15ファイル、build、公開allowlistが成功。check-final.log |
| `npm run test:e2e` | fresh4320・1 workerで126件成功。e2e.log |
| `npm run check:daily-archive` | 日英×Chromium/Firefox/WebKitの182件境界6フロー成功。browser-final.log、archive-browser-results.log |
| `npm run check:daily-start` | 36ケース成功。start-regression-final.log |
| `npm run test:daily-preview` / `npm run check:daily-lifecycle` | 既存の日次と撤回/再開がそれぞれ6フロー成功。daily-regression.log、lifecycle-regression.log |
| `npm run check:daily-rehearsal` | 切替前の開始/完遂/保存/履歴と、その後の原子的切替が6フロー成功。rehearsal-regression.log |
| 固定候補の配信整合/履歴/共有検査 | 日英×3ブラウザー成功。release-candidate.log、history-candidate.log、sharing-candidate.log。X/API/クリップボードの成功は模擬で、実投稿ではない |
| `npm run build:playtest` と同じ生成物のpromote | digest `2fa2ab0b3cbca06f648b8626e96bafe3247a8adb6c8b532638dc7342442d3083`。build-playtest.log、promote.log |
| 公開HTTPSの日英開始/ヒント/完遂/練習/保存・共有・整合/異常時拒否 | playtest-public.log、release-public.log、sharing-public.logが成功。固定ID/問題hash/保存形式を維持。共有は模擬結果を含む |
| HTTPS/ローカルの境界・health・新旧asset hash | public-boundary.json、boundary-public.log。日英トップ/固定URL200、8 assetsすべて200/hash一致、非公開API/索引/PRIVATE/合成日次404 |
| 書式/差分検査 | 今回の実装/テスト/スクリプトのPrettier検査と `git diff --check` が成功 |

本番は `/Users/ytimesy/projects/onebox/releases/m1-2fa2ab0b3cbc` へ反映済み。`var/previous` は `m1-87ec25e1e692` を保持する。開始時から動いていた専用Web PID26742/トンネルPID14063を再起動せず維持し、127.0.0.1:4321と公開HTTPSのhealthが正常であることを確認した。公開は固定1問の試遊版で、日次索引/合成182件/候補APIは公開していない。

実PRIVATE20ファイルの内容hashは作業前後で `dbf5e5d9a78549e090b0e133bafb0c23d331a9499b969cc56cfaa71356ec959c` のまま。実在庫はrevision1/ready0/required30。既存未コミット変更と保存v1を保持し、他アプリ/共有インフラ/DNS/課金/外部ジョブを変更していない。現在のアーカイブ実装と非公開自動検証を、正式日次・品質30問・実機/人間・長期無制限運用の完了とは扱わない。
