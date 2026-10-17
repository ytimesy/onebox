# 日次切替・計画再検証の実装記録 — 2026-10-17

ユーザーの「どんどん、実装を進めて」に対応。AGENTS/SPEC/TASK、既存日次CLI・候補台帳・保存/配信契約、未コミット差分と前回の確認結果を参照した。固定版を維持し、コードで独立して進められる非公開の切替検証を実装した。元の差分はevidence/daily-commit-20261017/before.diffに保持する。

## 実装した範囲

- 日次計画を現在の台帳・レビュー・品質在庫30問から再計算する。source_revisionだけでなく台帳全体のhash、前回manifest、公開履歴、UTC期限、canonical payload、独立Python2探索も照合する。過去manifestを省略して過去固定URLを落とす準備は拒否する。
- DailyRehearsalで配信データとコピー台帳/検証用履歴を同じsnapshotへ保存し、全検査後にcurrentを原子的に切り替える。旧版は不変のまま残す。検証用領域はevidenceかプロジェクト外の一時領域へ限定する。
- writer lockとexpected headで競合を拒否する。同じ計画の再実行は履歴1件を維持し、同じIDへの別内容・検証中のUTC日付変更は拒否する。
- 配信データ面はrelease.jsonとhash付きJSONだけ。余分なPRIVATEファイル、壊れたデータ、symlink、currentの外部パスを検査する。コピー台帳・人間報告fixtureは配信データ面へ出さない。
- `daily verify/rehearse/inspect-rehearsal/commit-rehearsal` を追加。前回の検証領域から読むのは、commit済みmanifestだけ。
- 切替前に3ブラウザー×日英の実UIを開始・タッチで完遂・保存・履歴まで確認する検証スクリプトを追加した。模擬投稿や実投稿は行わない。

## 変更ファイル

- packages/puzzle-tools/daily.ts — 計画v1、再計算/期限/履歴照合、独立Pythonの作業フォルダ固定。
- packages/puzzle-tools/daily-cli.ts — PRIVATE計画検証と非公開リハーサルのCLI。
- packages/puzzle-tools/daily-rehearsal.ts — 不変snapshot・単一writer・切替・原本保持。
- packages/puzzle-tools/daily.test.ts、daily-rehearsal.test.ts、tests/helpers/quality-catalog.ts — 共通の合成fixtureと境界/CLI/実プロセス中断の回帰。
- scripts/check-daily-rehearsal.mjs、package.json — ブラウザーによる切替前確認コマンド。
- SPEC.md、TASK.md、docs/DATA_CONTRACTS.md、docs/OPERATIONS.md、本書 — 範囲・契約・手順・未完了の記録。

## 検証

個別ログはevidence/daily-commit-20261017。

| 実行 | 結果 | 証跡 |
| --- | --- | --- |
| 着手時の型/単体 | 77件・10ファイル PASS | typecheck-before.log、unit-before.log |
| `npm run check` | 型/単体88件・11ファイル/build/allowlist PASS | check-final.log |
| 最終差分後の型検査と `npm test -- daily-rehearsal.test.ts daily.test.ts` | 対象13件 PASS。全体88件のうち日次関連を再確認 | daily-final.log |
| `npm run build:playtest` | PRIVATE混入検査 PASS、gzip 92,804 bytes | build-playtest.log |
| `npm run build:daily-preview` | localhost限定の合成問題build PASS | build-daily.log |
| `npm run check:daily-rehearsal` | 日英×Chromium/Firefox/WebKitの6フロー PASS。切替前の固定URL/hash/タッチ完遂/保存/履歴、非公開境界、切替後の履歴1回・同一計画再実行 | browser.log、browser-check.log、staged-result-390.png |
| `node scripts/check-release.mjs` | 候補生成物の3ブラウザーの配信異常・再試行、欠損/余分データのbuild拒否 PASS | release-local.log |
| 実在庫の `daily status` / `daily prepare` | ready0/required30/revision1を維持。prepareは30問条件でexit2。出力計画は未作成 | real-stock.log、real-block.log |
| Prettier / `git diff --check` | PASS | 最終コマンド出力 |

新しい単体検査では、実子プロセスをstaging後/activation前にexit77で終了させた後も旧版を読み出せた。死んだwriterのlockは保持され、再実行を拒否した。元領域を残して新しい検証領域へ再実行し、コピー台帳の履歴1回を確認した。物理停電や公開の復旧試験へ読み替えない。

M1の全126件E2Eは前回の記録で、今回は再実行していない。公開JS/CSS/Worker/紹介PNG/問題内容は前回と同一で、今回の変更対象は非公開CLI/配信検証コード。今回のUI E2Eは上記6フローと公開HTTPSの日英完遂。参照Python8件は今回再実行しておらず、日次準備/再検証内の独立Python2探索・hash一致は実行した。

途中の不一致も記録する。初回の全体試験で既存curation CLIテストが5秒を114ms超えて1件timeoutとなった。単独再実行では10件成功し、最終の全体試験でも成功した。新CLIの直接Node実行ではTypeScript parameter property非対応を検出し、通常のプロパティ宣言へ修正した。失敗ログを成功ログへ書き換えず保持する。

## 起動・確認手順

```sh
npm run daily -- status
npm run build:daily-preview
ONEBOX_COMMIT_EVIDENCE=evidence/daily-commit-20261017 npm run check:daily-rehearsal
npm run serve:daily-preview
```

ローカルUIは http://127.0.0.1:4327/ja/ と /en/。既存待受を停止せず、同じONEBOXの検証サーバーか確認する。ブラウザーの切替検証は毎回一時ルート/空きloopbackポートを使い、最後に自分が作ったサーバーと領域だけを終了/削除する。

本番は https://onebox.formflow-ops.com/ja/ と /en/、固定URL /ja/p/playtest-fixed-v1/。日次fixture/コピー台帳をpromoteしない。

## 本番反映とデータ保全

検証済みの固定版digest `3ad0d6ed41616b98e5ae6fda4cb32d7ccd6631df19e3fd4c5b811f4736abbb52` を同じ生成物のまま `m1-3ad0d6ed4161` へpromote。前版 `m1-da771e4fe6f3` はpreviousに保持した。固定ゲームの全4 assetsは前版と内容が一致し、問題ID/hash/rulesも維持する。buildごとのrelease.jsonのpublished_atだけ更新され、新しい日替わり問題が配信されたという意味ではない。

`npm run check:playtest -- https://onebox.formflow-ops.com` と `node scripts/check-release.mjs https://onebox.formflow-ops.com` がPASS。HTTPSの日英で開始/ヒント/タッチ完遂/保存、固定URL、manifest/JSON/hash、明示再試行を確認した。各*-public.logに記録。

health/日英トップ/固定URLは200、非公開検証領域・配信ツールのソース・snapshot.PRIVATE・候補/在庫API・合成日次URLは404。既存全assetsのHTTPS200と内容hash一致、localhost4327の日英200も確認した（assets-public.json、public-boundary.json）。補助のPython urllibはissuer検証で失敗したため、Nodeとブラウザーの通常の証明書検証を使ってHTTPSを確認した。TLS検証を無効化したり、PCの証明書設定を変更したりしていない。

実候補/台帳などprivateの全20ファイルは変更前後でdigest `dbf5e5d9a78549e090b0e133bafb0c23d331a9499b969cc56cfaa71356ec959c` が一致した（before.json、after.json）。合成workspace/計画/リハーサルはテストが作った固有名の領域だけを終了時に削除し、mainへ試遊/承認/公開を追加していない。既存未コミット変更・保存runは保持。サービス再起動・DNS/課金・外部ジョブ有効化・他アプリ変更なし。

## 残件

実在庫は候補5・人間報告0・承認0・有効公開待ち0、required30。実台帳の更新を伴う正式日次commit、公開後のレビューcontext再確認手順、定時主系、撤回・全過去アーカイブ、実機/人間の品質受入は未完了。snapshotは初回切替の非公開検証までで、正式公開実績に数えない。

今回も30問ゲートや既存のレビューcontext条件を緩和しない。履歴更新後はレビューが古くなるため、在庫の再確認/レビュー更新を経ずに毎日自動供給できるとは扱わない。検証中断後のロック/不完全snapshotは調査用に保持する。物理停電・PC再起動の耐久/復旧、実OS共有/VoiceOver/TalkBack/実端末完遂、前回の日次異常注入での単発access-controlエラーの原因特定は残る。

ONEBOX以外のアプリ、DNS/課金/外部ジョブ、既存の保存runは変更しない。実物端末/人間の試遊を自動操作や合成human_reportで代替しない。
