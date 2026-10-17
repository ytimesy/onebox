# 2026-10-17 修正調査・差分表

依頼: `/Users/ytimesy/Downloads/ONEBOX_CODEX_REVISION.md` v1.1。新規作成ではなく現行実装の修正。今回のユーザー指示により、本番反映・公開ファイル変更・DNS・課金・外部ジョブ有効化は禁止。過去の公開許可は今回の変更に適用しない。TASKS.mdではなくTASK.mdを更新する。

対象は `/Users/ytimesy/projects/onebox`、Gitルートも同じ、ブランチmain。着手前は未コミット差分なし。適用AGENTS.mdを確認し、親ディレクトリに追加AGENTS.mdなし、子AGENTS/overrideなし。README、SPEC、TASK、docsのGAME_RULES/UI_SPEC/ARCHITECTURE/DATA_CONTRACTS/GENERATION/ACCEPTANCE/OPERATIONS、既存ソース/テスト/fixture/lockfileを読んだ。独立したTASKS.md/CODEX_INITIAL_INSTRUCTION.md/ONEBOX_全体設計書.mdはこの作業フォルダに存在せず、総合SPECと配置済み原資料を参照。

React19.3.0/TypeScript5.9.3/Vite8.3.4、純粋game-core、Worker、localStorage、Vitest5.0.3/Playwright1.64.0を維持。依存更新・rules_version/公開ID変更なし。

修正前 `npm run check`: PASS（型・59テスト/9ファイル・build/allowlist、gzip84,942 bytes）。ログ: `evidence/revision-20261017/baseline-check.log`。初期E2Eは新規4320サーバーで開始したが修正作業と時間が重なったため、全件を修正前の証跡とは扱わない。最終E2Eを別途実行する。

| 要件ID | 要件 | 着手時の実装・挙動 | 状態と対応 | 修正対象 | 検証方法 |
|---|---|---|---|---|---|
| C01–C07 | 幾何学・合法完成・JSON検証 | 純粋関数/実行時検査、保存解非依存。30問/負例の独立Python照合あり | 再利用。別合法解・鏡像の明示的回帰を補強 | packages/game-core/index.ts、core.test.ts | 単体/参照Python |
| I01–I03 | タップ/ドラッグ/キー完遂 | 既存E2Eあり。候補の可否は確定後のメッセージ中心 | 再利用＋候補の可否文言 | apps/web/src/App.tsx、i18n.ts | 3エンジン完遂 |
| I04 | cancel/キャプチャ喪失/非表示 | cancel/非表示は既存。lostpointercapture未処理、終了pointer ID未照合 | 不一致を修正 | App.tsx | キャプチャ喪失/他pointer/二重完遂回帰 |
| I05–I07 | 幅/言語/操作練習 | 6幅・別チュートリアル・開始前非表示あり | 再利用。実機は未検証 | App.tsx、style.css | E2E/実機待ち |
| T01–T05 | 時計/境界/隠す/中断 | 60秒継続/ms判定/単調時計あり。表示floorで60,001msが1:00、非有限値の防御不足 | 表示切上げ、時計異常防御、DOM準備後の区間開始 | App.tsx | 境界・異常時計回帰 |
| T06–T08 | 初回/練習/二重完了 | 再開始確認、abandoned、初回終端保護あり | 再利用、保存排他との連携補強 | App.tsx、storage.ts | E2E/単体 |
| P01/P04 | 保存/復帰/互換性 | 配置等は保存するがundoはReact stateのみ、復帰時消える | 追加任意フィールドundo_historyで既存v1を維持 | index.ts、storage.ts、App.tsx | 旧v1読込/履歴検査/リロード取消 |
| P02/P03 | 保存障害/隔離 | メモリー退避あり。隔離キーが固定で、隔離保存失敗後も元current削除 | 一意な隔離キー、退避成功時だけ元を削除。初回性不明は練習 | storage.ts | quota/破損/ほかの正常記録の保持 |
| P05/P06 | 多重タブ/遅延保存 | Web Locksあり。代替localStorage leaseは非原子的。明示引継ぎなし | IndexedDB短期transaction＋所有者tokenでclaim/保存/heartbeatを直列化、引継ぎ追加 | lease.ts、App.tsx | 同時開始/遅延保存/引継ぎE2E |
| P07 | 削除/180問整理 | 明示削除はONEBOXだけ。通常pruneがfirst markerも削除 | 通常整理は軽量初回識別を残す | storage.ts | 181問の回帰 |
| H01–H05 | ヒント/解答 | Worker/上限/世代/実表示時count/解答確認あり | 再利用、操作中の古い応答回帰 | App.tsx、hint.worker.ts | E2E/単体 |
| D01/D04–D07 | manifest/固定URL/hash/通信断 | 固定practice限定のmanifest照合/固定URL/404あり | 再利用。正式日次への接続は未実装 | PublishedApp.tsx、release.ts、static-server.mjs | ローカル公開候補チェック |
| D02/D03 | UTC日替わりとrun固定 | daily契約とprivate prepareのみ、playtest UIはdaily拒否 | 正式日次は未実装。品質在庫0/人間試遊前のためゲート維持 | daily.ts、PublishedApp.tsx | 合成契約テスト/実在庫read-only |
| S01–S04 | 共有文/画像/代替 | 公開固定practiceのみ実装、失敗代替あり | 再利用。ローカルから本番originを共有する差を修正 | sharing.ts、ShareResult.tsx | 3エンジン共有/画像失敗 |
| Q01–Q03 | 解数/重複/独立照合 | 限定CLI、5状態、幾何学キー、Python照合あり | 再利用/再検証。大量生成なし | puzzle-tools、verification | 単体/参照Python |
| Q04 | 品質30問 | 既存候補5、品質受入在庫は前回0。実データは読取で再確認 | 人間試遊/承認待ち。合成を実台帳へ入れない | daily status/curate stock | 読取のみ |
| Q05/Q06 | 混入防止/切替と復旧 | 固定公開候補allowlistとpromote/復旧手順あり。日次commitなし | ローカル候補検証まで。本番promote禁止 | build-playtest/check-dist等 | dist境界/専用localhost |
| U01–U05 | 実物端末/支援技術/人間試遊 | 前回スマホ1ピースのみ | BLOCKED: 実物端末/協力者による操作待ち。自動WebKitと区別 | docs/ACCEPTANCE.md | 手動試遊票 |
| O01–O04 | 安全/集計/全体検証/権限 | 集計は初版不採用。lint scriptなし | 既存prettier対象確認、型/単体/E2E/build。外部変更禁止 | ONEBOX内のみ | diff/ログ/候補digest |

適合判定はソース確認と既存テストに基づく初期分類。今回の実測と各IDのPASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLEは `REVISION_REPORT_20261017.md` で記録し、既存受入IDを削除しない。日次の定時ジョブ、一般公開、人間の難易度、実機受入をこの差分表だけで完了にしない。

最終追記: D01–D07は別のdaily-previewビルドへローカル検証コードを接続した。正式日次の公開commit/全過去アーカイブ/横断履歴/更新通知/定時主系の残件と品質0/30は維持。最終実測は修正報告書を参照。
