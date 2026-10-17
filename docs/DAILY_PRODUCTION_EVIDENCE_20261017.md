# 正式日次版の公開（2026-10-17）

## 公開後のGitHub範囲監査

公開ソースの検査で、本番の未公開候補を再現できるseedが新しいテストに使われていることを発見。公開前にテストを独立した合成seedへ変更し、生成する30問と実候補の幾何学的非重複を確認した。さらに、過去の公開済み設計用seedに一致する5候補を、元問題/試遊/編集情報/監査履歴を保持したままrejectへ移行し、今後の配信対象から除外。過去のGit履歴は書き換えず、人間の試遊承認も作っていない。

実編集台帳はrevision5・全35件保持（候補30/対象外5/人間報告0）。機械検証による未公開在庫は29問。当日公開ID/payload hashを維持してrefreshし、現行生成物digestは `50490b5cc5420498cad8cb0ddbade627a7cf4836f10d5fb088de8f3b24d5579b`。snapshotは `0ecc886ed2eba855b84a5dcd643c7767ec7bcb3fd125f27169dc2876afb2f0f3`。以下の初回公開のdigest/台帳不変/在庫34問は、その時点の記録として保持する。追加検査は `evidence/github-push-20261017/`。

ユーザーが「試遊の確認はスキップして、正式版の公開を進めて」と明示したため、人間の試遊/実機/難易度承認を公開前条件から外して、正式日次版を公開した。公開の再承認は求めていない。人間の報告や編集承認は作らず、従来の人間評価台帳35候補・revision4・報告0・承認0をそのまま保持した。新しい公開ポリシーは `ops/production-policy.json`、原仕様からの変更はAGENTS/SPEC/TASK/OPERATIONSに記録する。

## 公開状態

- 日本語: https://onebox.formflow-ops.com/ja/
- 英語: https://onebox.formflow-ops.com/en/
- 当日固定URL: https://onebox.formflow-ops.com/ja/p/onebox-2026-10-17/ と英語版。
- 以前の共有URL: /ja/p/playtest-fixed-v1/ と英語版を、元の問題hashの練習として維持。
- 公開stage: daily、版2026-10-17、production_daily。公開時に機械検証済みの未使用候補34問。
- 公開生成物digest: `938266da5530d933880e940ce1c4482be0579f42ee8740a96be8f860ac1ff736`。
- snapshot: `var/production/snapshots/fd21f3210a23cda5532a2f4361d68f9d299ca17a033ce84d691653e2d6d896ba/`。publicだけがvar/currentから配信され、PRIVATE履歴は兄弟階層に保持される。
- 当日payload hash: `fa54a25f1a6fb7dbabdc40a05a97331e9cab0f72d4099024a64ac662d70ec3ec`。旧practiceは `b30042deab13615c3fb6c3c1082f7d457607ee9e0ffa82ba077d416f5406c9b3` のまま。
- gzip JS/CSS/Worker: 95,412 bytes、250KiB以内。未来問題JSON、seed、保存解、候補/編集APIは公開していない。

## 実装と変更ファイル

| ファイル | 結果 |
| --- | --- |
| apps/web/src/main.tsx、PublishedApp.tsx、App.tsx | dailyビルドを既存の公開データ検証/保存/開始前確認/共有/履歴へ接続。正式日次の文言・現地更新時刻・canonicalを設定。旧固定URLはpractice-release.jsonで元の問題を読む |
| scripts/production-release.mjs（新規） | 30問の機械検証済み初期在庫、公開する問題のJS/Python2方式照合、初回/継続の候補選択、PRIVATE実公開履歴、全公開済み索引、枯渇時の練習退避、撤回、厳密な公開allowlist/hash/容量、staging、UTC/source/head/digest再確認と原子的切替 |
| scripts/production-http.mjs（新規）、static-server.mjs | 同じ専用サーバーで日次/旧固定版を配信。current snapshotを固定して処理し、当日/過去URLと参照されたJSON/索引だけを許可。撤回410/JSON404、全撤回503、未来/private404、旧assets保持、従来のCSPを維持 |
| scripts/build-production.mjs（新規）、playtest-pages.mjs | 既存Vite/Reactと紹介PNG生成器を再利用し、正式版のbundleと盤面/解答を含まない汎用OG画像を生成。固定版のデフォルト画像は変更しない |
| scripts/check-production.mjs（新規） | 新しいloopbackサーバー/使い捨てブラウザーで開始/通信断完遂/保存/共有内容/日英/幅/異常JSON拒否と再試行/境界を検査。公開HTTPSでも同じ操作を検査 |
| scripts/publish-daily.mjs（新規） | status/publish/refresh/recall。事前ブラウザー検査→同じdigestだけをactivate。同日の再実行を抑制し、撤回の制御時刻を当日公開の実績と取り違えない |
| scripts/install-production-agent.py（新規） | 専用PCローカルLaunchAgentだけを導入。既存アプリ/公共トンネル/共有DNS/外部ジョブへ変更なし |
| tests/production.test.mjs（新規） | 人間報告なしの明示ポリシー、30問条件、在庫減少/枯渇、改変/UTC/CAS/排他、原子的切替/旧データ保持/撤回、複数日の実ブラウザー検査 |
| packages/puzzle-tools/daily-cli.ts | 旧statusをhuman_review_inventoryと明示。品質報告0を完成とせず、新しい本番statusへ案内。旧人間承認用prepare/rehearsalはその条件を保持 |
| package.json、.gitignore、ops/production-policy.json、AGENTS.md、SPEC.md、TASK.md、README.md、docs/OPERATIONS.md、本書 | コマンド、非公開生成物境界、ユーザー決定、起動/復旧/残件を更新 |

## 実行コマンドと結果

証跡は `evidence/daily-production-20261017/`。今回のブラウザー確認は自動操作であり、人間の試遊結果ではない。

| コマンド/確認 | 結果/ログ |
| --- | --- |
| npm run check | 型/単体109件・15ファイル/build・従来dist allowlist成功。check.log |
| npm run test:e2e | fresh4320・1worker、3エンジン126件成功。e2e.log |
| npm run build:production | 型検査とproduction shell生成成功。build-deploy.log |
| npm run test:production | 4複合テスト成功。production-accepted.log、portable-production-tests.log。後者は配布用のdist-playtestを参照し、特定の本番release名に依存しない |
| node --test --test-name-pattern 'explicit machine policy' tests/production.test.mjs | 制御/撤回時刻と当日公開実績の区別を含め成功。control-timestamp.log |
| npm run test:server | 固定版のHTTP/CSP/cache/private/symlink/rollback境界が成功。server-final.log |
| ONEBOX_ALL_ENGINES=1 npm run production -- publish | 当日と旧固定practice、日英×3エンジンで12完遂フローと幅320/390/768/1440、manifest異常拒否/明示再試行、private/未来境界が成功してから原子的切替。publish.log、candidate/ |
| npm run check:production -- var/current https://onebox.formflow-ops.com | HTTPSの日英・当日/旧固定URLで開始/通信断完遂/保存/共有・幅・異常時拒否と再試行が成功。public.log、public/。Xの投稿確定は行っていない |
| HTTPSのmanifest/JSON/hash/索引、新旧asset、公開境界 | 参照情報/bytes一致、新旧8assetすべて200/hash一致、日英当日/旧固定URL200、未来URL/候補API/台帳/private404。after.json |
| python3 scripts/install-production-agent.py | local.onebox.daily導入、起動時の同日再実行が正常終了。install-agent.log、agent-state.log、services-after.log |
| npm run production -- publish（再実行） | already_published_today、問題/履歴を追加しない。replay-final.log |
| Prettier/構文/git diff --check | 成功。style-final.log。既存未コミット差分を破棄していない |

最初の追加テストでは、macOSのtmpパスがsymlink経由だったため安全な正規パスを使うようテストを修正した。英語の完成見出し、再試行ラベル、CSSで大文字表示された日次見出しの期待値も実際のUIへ合わせた。失敗ログと最終成功ログは分離し、テスト期待値の修正を製品バグ修正として数えない。英語/日本語の失敗を隠して公開したものではない。

本番Webだけをkickstartし、旧固定版のhealth正常を確認してから日次を切り替えた。専用Web PID32772、トンネルPID14063を確認。reviewer25995/私設LAN gateway27267と他アプリ/共用トンネル設定は維持。var/previousは旧固定m1-2fa2ab0b3cbc。旧release/snapshot/assetsを削除していない。実編集台帳の内容hashは作業前後で一致し、revision4・候補35・人間報告0のまま。

## 起動・運用と残件

PC上のWebは127.0.0.1:4321、専用local.onebox.webと既存トンネルで公開する。日次更新はlocal.onebox.dailyの60秒間隔UTC日付チェック。JST09:00以降に当日の問題を公開し、PC停止/スリープから戻った場合は現在日付に追いつく。定時の厳密な同時公開やPC停止中の新規アクセス継続は保証しない。次の予定は2026-10-18 09:00 JST。実時刻での翌日更新はまだ観測していない。

状態確認は `npm run production -- status`、bundle更新はbuild:production→test:production→production refresh→HTTPS確認。現在の品質承認待ちは公開の必須ゲートではなく、元の `daily status` は人間評価用在庫の報告である。PRIVATE公開履歴/本番公開ポリシーを人間評価の品質台帳と混同しない。停止/切戻し/ロック復旧はdocs/OPERATIONS.mdの最新節を参照。

未実施/残件は、人間の難易度/操作性評価、実物iPhone/Android/VoiceOver/TalkBack/実OS共有、PC物理停止/再起動からの復旧、翌日実時刻の更新観測、長期間の公開観測/複数地点、候補の継続補充、source台帳/索引の長期分割。以前の単発access-control pageerrorの原因は未特定で、今回の自動操作では再現していない。今回のユーザー決定で試遊を公開の前提から外したのであり、未実施項目を完了へ変えてはいない。
