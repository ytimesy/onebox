# 日次履歴と取得済み問題の復帰 — 2026-10-17

ユーザーの「開発を進めて」に対する継続開発。既存の固定問題・日次preview・Store/Attempt v1を再利用し、別アプリの作成や大量生成をしない。適用AGENTS、SPEC/TASK、修正指示書v1.1、現行コード・テスト・未コミット差分を確認した。既存差分は `evidence/daily-history-20261017/before.diff` に記録し、保存データと候補台帳を保持する。

## 差分と実装

| 項目 | 着手時 | 今回 |
| --- | --- | --- |
| T33 日次の直近7回 | 固定1問だけの履歴 | daily-previewでmanifestが許可する非撤回の日次問題をまたぎ、検証済みrunを7回表示。各日付から当該固定URLへ移動 |
| 保存の検査 | 当該1問のAttempt検査 | 同じ検査を共用。問題payloadのID/purpose/hash・合法配置/終端・runキーを検査し、操作練習/非公開/不正記録を除外 |
| 取得失敗 | 履歴の非同期取得なし | 読込中表示、10秒の通信期限、閉じる時の中断。確認できた問題だけ表示し、未確認分を警告。元の保存run/初回識別は保持 |
| 記録の消去と競合 | 同期履歴のみ | 問題取得中の全消去・個別削除を再確認し、既に集めた記録も復活させない |
| 通信断の再開 | sessionStorageに最後の1問だけ | manifestが許可する取得済みpayloadを複数保持。別問題を訪れた後も過去固定URLへ復帰可能。未取得なら別問題へ差し替えず停止 |
| キャッシュ不整合 | manifest通信失敗の代替のみ | payloadのnetwork/timeout/5xxも取得済み版の練習へ退避。4xx、不正JSON/hashは自動代替せず停止。新manifest受信時に撤回/除外分を削除 |

固定公開版は従来の1問の履歴・文言と保存v1を維持する。日次の追加機能はlocalhost限定。次回時刻の表示と過去結果から今日へのリンクは既存の日次preview実装を再利用し、品質30問や公開commit/定時実行を済ませたとは扱わない。

## 変更ファイル

- `apps/web/src/App.tsx`: 日次previewの履歴接続。
- `apps/web/src/RecentAttempts.tsx`: 複数問の検証済み履歴、日付リンク、読込/一部取得失敗/中断。
- `apps/web/src/storage.ts`: 既存検査の共用、日次の履歴抽出、読込中の消去競合。
- `apps/web/src/PublishedApp.tsx`: 複数問キャッシュとpayload通信失敗時の復帰。4xx/破損の拒否。
- `apps/web/src/public-cache.ts`: 公開データ専用の任意sessionStorageキャッシュ。旧単一payload形式を読める。
- `packages/game-core/storage.test.ts`、`packages/game-core/public-cache.test.ts`: 検査・競合・破損・旧形式・保存不能の単体回帰。
- `scripts/check-daily-preview.mjs`: 日英/3エンジン・複数問・通信断・撤回・6幅の操作検証と分離した証跡出力。
- `SPEC.md`、`TASK.md`、`docs/DATA_CONTRACTS.md`、`docs/UI_SPEC.md`、`docs/OPERATIONS.md`、本書: 実装範囲と残件の記録。

## 検証状況

修正前: `npm run typecheck` PASS、`npm test` 67件/9ファイル PASS。個別ログは `evidence/daily-history-20261017/`。

| 実行コマンド | 最終結果 | 証跡 |
| --- | --- | --- |
| `npm run check` | 型/単体77件・10ファイル/build/公開allowlist PASS | check.log |
| `npm run build:playtest` | 最新ソースの型/build/PRIVATE混入検査 PASS、gzip 92,804 bytes | build-playtest-final.log |
| `npm run build:daily-preview` | 合成2版の専用ローカルbuild PASS | build-daily-final.log |
| `ONEBOX_DAILY_EVIDENCE=evidence/daily-history-20261017 npm run test:daily-preview` | 日英×Chromium/Firefox/WebKitの6フロー PASS。複数問履歴、停止/フォーカス、6幅、複数問キャッシュ、未取得拒否、通信断、4xx/破損拒否、撤回除外、ローカル切替/復旧 | daily-test-verified.log、daily-preview.txt、history-390.png、history-1440.png |
| `npm run test:e2e` | fresh4320、42項目×3エンジン=126件 PASS | e2e.log |
| `npm run check:history` | 固定版・日英×3エンジン、7回/時間非表示/一時停止/保存不能/削除/4幅 PASS | history-local.log |
| `npm run check:sharing` | 固定版・日英×3エンジン、X画面模擬/共有/画像/境界 PASS | sharing-local.log |
| `node scripts/check-release.mjs` | 3エンジンのmanifest/ID/rules/hash/通信異常・再試行、欠損/余分payloadのbuild拒否 PASS | release-local.log |
| `npm run check:playtest -- http://127.0.0.1:4326` | 候補生成物の日英×3エンジン、開始/ヒント/タッチ完遂/保存/CSP PASS | playtest-local.log |
| 変更コードのPrettier、`git diff --check` | PASS | 最終コマンド出力 |

ブラウザーは自動操作であり実物端末/人間の試遊ではない。X/OS共有/clipboardの成否は模擬で、今回実投稿は行わない。参照Python8件は今回再実行していない（ソルバー/問題生成の変更なし）。

途中の追加検査で「sessionStorageから外した問題はoffline時に取得できない」と仮定して1件を期待したところ、ブラウザーのHTTPキャッシュから合法に取得でき2件表示された。取得不能の検査は当該payloadリクエストの明示的な中断を追加し、HTTPキャッシュと任意sessionStorageを区別する。

その後の異常注入検査でrelease.jsonのaccess control checksというpageerrorを1回観測した。発生段階の記録を追加し、3ブラウザーの最小切り分け、WebKit単独、日英×3の全体を実行したところ再現しなかった。全体再実行では操作・破損拒否・通信復帰がすべてPASS。原因は未特定で、正式日次の受入前の再確認事項として残す。初期の失敗ログも保持し、成功扱いへ書き換えない。

## 起動手順・公開境界

```sh
npm run build:daily-preview
ONEBOX_DAILY_EVIDENCE=evidence/daily-history-20261017 npm run test:daily-preview
npm run serve:daily-preview
```

ローカル日次検証: http://127.0.0.1:4327/ja/ と `/en/`、過去固定URL `/ja/p/onebox-2026-10-16/`。日付は合成fixtureで、実際に公開/品質承認した問題ではない。サーバーはloopbackだけへbindし、このディレクトリをpromoteしない。別プロセスが4327を使っている場合は停止せず、既存のONEBOX検証サーバーを確認するか `ONEBOX_DAILY_PREVIEW_PORT` に空き専用ポートを指定する。

固定公開候補: `npm run build:playtest`、`ONEBOX_SERVE_ROOT=$PWD/dist-playtest ONEBOX_PORT=4326 npm run serve:playtest`。既存4326が同じ候補を配信している場合は新規起動しない。

本番は既存の https://onebox.formflow-ops.com/ja/ 、英語 `/en/`、固定URL `/ja/p/playtest-fixed-v1/`。検証済みの同じ固定版digestだけをpromoteする。

## 本番反映・HTTPS確認

`npm run promote:playtest -- da771e4fe6f349ccaf92ff346e8b8be5052545666e934cab8e3d2153084859cd` を実行し、同じ生成物を `releases/m1-da771e4fe6f3` へ反映。`var/previous` は従来の `m1-bbd223e86427` を保持する。再ビルド、サービスの再起動、DNS/トンネル/外部ジョブの変更は行っていない。promote.logとpublic-boundary.jsonでdigest一致を確認した。

公開HTTPSに対して、`npm run check:playtest -- https://onebox.formflow-ops.com`、`node scripts/check-release.mjs https://onebox.formflow-ops.com`、`npm run check:history -- https://onebox.formflow-ops.com`、`npm run check:sharing -- https://onebox.formflow-ops.com` がすべてPASS。日英の開始/ヒント/タッチ完遂/保存・固定URL・manifest/payload/hash・履歴・共有内容/模擬X導線を確認した（各*-public.log）。

日英トップ/固定HTML/healthは200で最新JS/CSS名を参照。新旧releaseの全assetsはHTTPSで200かつローカル内容hash一致。候補API/在庫API/reviewer/日次検証ディレクトリ/合成日次固定URL/privateパスは404。公開版はstage=playtestの固定1問を維持し、日次機能を本番公開したとは扱わない。共用zoneのタグは従来どおりCSPで遮断され、完全非挿入を満たしたとは報告しない。

起動中のlocalhost4326固定候補、4327日英日次/過去固定URLも200を確認（local-urls.json）。実候補/台帳などprivateの20ファイルは変更前後で内容digest `dbf5e5d9a78549e090b0e133bafb0c23d331a9499b969cc56cfaa71356ec959c` が一致（preserved-state.json/after-state.json）。在庫statusもrevision1/ready0を維持する。

## 未完了

- 品質在庫: `npm run daily -- status` は `ready:0 / required:30 / source_revision:1`。実候補5問、人間報告0、承認0、公開待ち0を保持。
- 正式日次の公開commit・台帳/履歴更新・全過去アーカイブ・withdrawal運用・定時主系ジョブの実装/有効化、日次の本番HTTPS受入は未完了。
- 実物iPhone/Androidでの一問完遂、指ドラッグ、VoiceOver/TalkBack、結果からの実OS共有、補助なしの人間の難易度評価、CA設定/LAN HTTPS実端末接続は未確認。
- 物理PC停止・再起動からの復旧、複数地点、継続観測、共用zoneのタグ完全非挿入は従来の残件。
- 取得済みmanifestだけで通信断中に新たな撤回を知ることはできない。復帰時は練習を明示し、新manifest受信時に撤回を反映する。

既存未コミット変更を破棄せず、ONEBOX以外のアプリ・DNS/課金・外部ジョブは変更しない。自動検証を実物端末/人間試遊・品質受入・正式日次公開の証拠に読み替えない。
