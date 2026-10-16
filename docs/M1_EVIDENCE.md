# M0 / M1 開発・検証証跡

日付: 2026-10-12（JST）。以下は初回M0/M1のローカル開発検証時点の記録。後続のHTTPS試遊・ヘッダー・常駐化は `PLAYTEST_EVIDENCE.md` を参照。日次版の本番受入は未完了。

## 実装した内容

- `packages/game-core/index.ts`: 契約検査、連結性、回転、衝突、配置/完成、保存記録検査、canonical hash、60秒タグ、ヒント選択。
- `packages/game-core/solver.ts`: UI非依存の上限付き配置探索。M1のヒント用途のみで、事前生成・編集CLIは未実装。
- `apps/web/src/App.tsx`: 日英トップ、タップ/ドラッグ/キーボード、プレビュー、戻す/取消、時計、停止/復帰、ヒント、解答表示、結果、設定、別問題の操作練習。
- `apps/web/src/storage.ts`: 名前空間付き保存、初回識別、終端記録保護、破損隔離、保存不能時のメモリー継続、180問の整理。
- `apps/web/src/hint.worker.ts`: 上限付きヒント探索をWorkerへ分離。UIは結果表示成功時だけヒント数を増やす。
- `scripts/check-dist.mjs`: 出力allowlistと秘密/PRIVATE/バッチ/負例の混入検査、圧縮サイズ確認。正式な公開purpose/manifest検査はM2〜M4で追加する。

既存アプリのコード・DB・設定は変更していない。依存とブラウザーはこのプロジェクト用に導入。ゲームのGPU/LLM処理や大量問題生成、本番負荷試験は行っていない。

## 環境・コマンド

- macOS arm64、実行Node 24.6.0 x64、Python 3.13.7。依存固定はpackage.json/lockfile。
- `npm run preview`: http://localhost:4319 （ビルド済み開発版、実行中）。localhostと127.0.0.1の記録は別オリジン。
- `npm run typecheck`: TypeScript 5.9.3で成功。
- `npm test`: 16件成功。幾何学・契約・一意性/負例/探索上限・保存検査・60秒境界・ヒントを確認。
- `python3 -m unittest discover -s verification -p test_reference.py -v`: このPCで8件成功。30問を参照exact-coverと独立DFSで照合。製品E2Eや実機の代替にしない。
- `npm run build`: 型検査・Viteビルド・dist検査成功。JS+CSS+Workerのgzip合計83,471 bytes、250KiB目安以内。開発fixtureのみで、正式公開bundleではない。
- `npm audit --audit-level=high`: 既知脆弱性0（実行時のレジストリ検査結果）。
- `ONEBOX_TEST_URL=http://127.0.0.1:4320 npm run test:e2e`: ビルド済みdistをローカルpreviewで検証。69件すべて成功（23項目×3エンジン）。最終結果は `evidence/e2e-build.log` を参照。

## 操作検証と証跡

Chromium、Firefox、WebKitの自動ブラウザーエンジンで以下を検証。市販ブラウザー実機の確認とは区別する。

- タップ相当/キーボード/ドラッグで一問を合法完成。実際のtouchイベントでもタップ完遂。
- 固定マスへの配置拒否、無効ドロップ・pointercancelで元配置維持、取り消し。
- ヒントの表示成功時だけ計数、取消でヒント数不変、Worker失敗/タイムアウトでも続行。
- 初回結果が練習・再読込で不変。解答表示をrevealedとして記録し、完成と区別。
- 手動停止/再読込で盤面とピースを覆い、復帰後は中断あり/resumed。言語切替で同じ問題を維持。
- 保存拒否でも完遂、破損記録から回復、削除はONEBOXキーのみ。
- 別タブが同じ問題の初回runを上書きせず、元タブ閉鎖後に継続。
- 60秒超過でも続行、開始前/途中の時間非表示、読み込み後の通信断でも完遂。
- UTC境界・端末時計ジャンプでもID/hash/runを維持し、uncertainを保存。
- 320/375/390/768/1280/1440pxで横はみ出しなし、主要操作44×44px以上。

スクリーンショット: `evidence/welcome-390.png`、`evidence/play-390.png`、`evidence/play-1440.png`、`evidence/result-390.png`。E2Eログ: `evidence/e2e-build.log`。型検査・コア・ビルドログ: `evidence/core-build.log`。開始/完成とprefers-reduced-motionのローカル確認は `evidence/local-smoke.txt`。詳細HTMLレポートは `playwright-report/index.html`（生成物、git対象外）。

## 検証で修正した点

- 途中から容量超過になる場合、成功済みの古い保存より新しいメモリー状態を優先して再開する（追加の保存回復テスト）。
- 同じタブの一時停止から再開する際、既存Web Lockを保持して再利用する。自分のタブを競合扱いしない。
- 時計ずれ判定後にスナップショットを作成し、uncertainが保存時に落ちないよう修正。
- SVGの座標変換で掴んだセルと形の左上基準の差を保持。
- ドラッグテストは1280×1000pxで盤面/トレイ/回転ボタンが見える条件に統一。低いviewportでテスト側が画面外へドロップしていた失敗は、実装不具合の通過扱いにせず、条件を記録して再検証した。

## 未確認・次のゲート

以下は初回ローカル検証時点の記録。後続のHTTPS公開、Chrome実ブラウザー自動確認、スマートフォンでの最初の配置確認、補助lease/短い画面の修正は `PLAYTEST_EVIDENCE.md` に追記した。現在の進捗はTASK.mdを参照。

- ユーザー回答は「まだ試していない」。人間の試遊は未実施。
- 実物の小画面iPhone/Androidでの指ドラッグ、低い画面での操作負担、iOS Safari/Android Chrome/デスクトップ実ブラウザーの確認は未実施。
- VoiceOver/TalkBackの操作完遂、20人程度の試遊、難易度中央値/離脱の測定は未実施。
- 操作反応p95、実機性能、運用ヘッダー/CSPは未検証。幅エミュレーションを実機確認に置き換えない。
- 非Web Locks環境の補助leaseは実装済みだが、厳密な競合検証は未実施。保存不能時に別タブを跨ぐ初回記録保護は保証できない。
- 本番環境はこのPCだが、今回のlocalhost起動は本番公開ではない。HTTPS公開URL、常駐/自動起動、日次manifest、固定共有URL、画像共有、日次ストック、公開手順はM2〜M4で実装する。

M0は完了。M1のコード・自動検証を進めたが、T15の実機・人間試遊が残るためM1全体は未完了。AGENTS.mdの「実機操作の確認前にM2以降を大規模実装しない」に従い、次は試遊結果を受けた操作改善と実機確認。
