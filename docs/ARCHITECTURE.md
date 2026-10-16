# 技術設計
## 採用案
新しいリポジトリ `onebox` を作る。コード上も運用上もdailyvideoから独立する。
フロント: TypeScript + React + Vite。盤面はDOM/SVG。ゲームコアはUI依存のないTypeScript。
事前生成: Node.js CLI。テストはVitest / Playwrightを候補とし、実装時に互換バージョンを公式資料で確認する。
既存のRails環境を調査することはできるが、パズルのためだけに常時稼働Rails+DBを必須にしない。

## 処理の配置
```text
Mac mini / 開発・生成CLI
  候補生成 → 全探索検査 → 試遊 → 公開待ち（非公開）
                         ↓ 承認済みの公開処理
CDN / 公開済み静的アセット
  HTML, JS, CSS, 公開済み問題JSON, release.json, 解答なしOG画像
                         ↓
利用者のブラウザー
  操作・判定・時間・ヒント・個人記録・共有
                         ↓ 任意、ゲームには非必須
/collect/* のWorker → D1等の集計ストア → 非公開集計
```
サーバーが1操作ごとに正解を返す方式は採用しない。読み込み済み問題は通信が切れても完成できる。
初版ではService Worker/PWAを必須にしない。初回訪問からの完全オフライン動作は対象外。

## 推奨公開先と注意
第一候補はCloudflare Workers Static Assets。静的アセットへのリクエストは現行資料で無料・無制限とされるが、Worker実行は別の課金/制限を受ける。[S5]
`run_worker_first=true`で全パスをWorkerに通してはいけない。動的にするのは原則`/collect/*`のみ。
/collectが429・障害・停止でも、ゲームHTML/JS/問題JSONを静的配信する。
この構成には契約・DNS・セキュリティ設定の確認が必要で、自動で本番変更しない。
Mac mini上でのみ起動する段階でも同じ静的distを動かせるようにする。

## ディレクトリ案
```text
apps/web/                 # UI, i18n, route shells
packages/game-core/       # geometry, reducer, validation, serialization
packages/puzzle-tools/    # generate, solve, curate, validate, publish preparation
workers/collector/        # 公開βで有効化する場合のみ
content/private/          # 公開待ち・解答、公開distへコピーしない
content/published/        # 承認済み公開問題と履歴
scripts/                  # check, build-public, release, rollback, export-promo
```
公開出力はallowlistから作る。privateを置いてから除去する方式を避ける。
参照パッケージのPythonは独立照合用。実装ではTypeScript版と結果を突き合わせる。

## 公開URL
`/{locale}/` トップ、`/{locale}/p/{slug}/` 問題固定ページ。
`/assets/{hash}.*`、`/puzzles/{hash}.json`、`/release.json`。
slug例は `2026-10-12-a`。ID/slugは表示名であり、解答のseedを表に出さない。
PUBLIC_ORIGINは承認済みURLを設定する。仮ドメインが取得できると想定しない。

日英のトップと公開済み問題URLはビルド時にHTMLシェルを生成する。
各ページにtitle、description、canonical、hreflang、解答を載せないOGを含める。
不正slugは真の404。全URLを200のSPAにして存在しない問題を正常ページ扱いしない。
未公開・撤回問題は公開ページを生成しない、または明示的な利用不可ページと適切な状態コードにする。

## 公開manifestとキャッシュ
`release.json`が現在の公開問題を指す。端末の日付から乱数で問題を作らない。
長期不変のハッシュ付きJS/問題JSONはimmutable、manifest/HTMLは再検証する構成にする。
公開先のヘッダー・HTMLパス正規化の挙動は実環境で確認する。[S8][S9]

開始時にmanifest→JSON→ハッシュ/ルール検査を完了し、そのIDをrunに固定する。
タブ復帰時と更新予定時刻後にmanifestを再検証するが、プレイ中に問題を差し替えない。
公開完了とは複数地点からのmanifest/JSON/固定URLの整合確認まで。
厳密な同時刻配信SLAは初版で約束しない。

## 任意のデータ集計
ゲームの実行にDBは不要。集計導入時は`POST /collect/events`を独立追加する。
初版の小規模テストは直接観察・任意フィードバックでもよい。一般公開での集計同意は任意とする。
必要テーブルはevents、daily_metrics、集計ジョブ管理だけ。会員・課金・チャットは追加しない。

## 性能目標（未測定の受入目標）
最初のJS+CSSは圧縮後250KB以内を目安にし、問題JSONは10KB以下。
ゲーム開始までに動画・外部フォント・重い解析タグを読み込まない。
操作への見た目の反応p95が100msを超える場合、端末条件と計測方法を記録して改善する。
ヒント探索はWeb Workerへ。上限に達したら中止しUIを固めない。
将来の本番負荷試験は所有者の承認したstagingだけで行う。
