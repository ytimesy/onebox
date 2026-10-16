# ONEBOX

4つの形を、ひとつの箱に。登録不要の箱詰めパズル。

現在は固定問題を試す公開版です。このPCから [公開URL](https://onebox.formflow-ops.com/ja/) を配信しています（[English](https://onebox.formflow-ops.com/en/)）。[同じ問題の固定URL](https://onebox.formflow-ops.com/ja/p/playtest-fixed-v1/) と、完成後の共有確認・リンクコピー・結果画像保存、端末内の直近7回の記録を利用できます。日次配信は準備中。品質30問・実機確認・正式日次版の本番受入は残しています。

## 起動と確認

Node.js 24.6.0 / Python 3.13.7で検証。依存はpackage-lock.jsonに固定。

```sh
npm ci
python3 scripts/prepare-test-fixture.py
npm run dev
```

ローカル: http://localhost:4319 。端末内記録はオリジン単位なので、localhostと127.0.0.1では別になります。
スマートフォンのLAN HTTPアクセスはWeb Crypto等の安全なコンテキスト要件を満たしません。実機試遊時はHTTPS経路を用意して確認します。
非公開候補のLAN HTTPS試遊は https://ishiisachionoMac-mini.local:4325/ へ追加しました。スマートフォン側の試遊用証明書設定とPC内アクセスコードが必要です。設定・運用は [PRIVATE_PHONE_TRIAL.md](docs/PRIVATE_PHONE_TRIAL.md)。公共トンネルには接続していません。

```sh
npm run typecheck
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run build
npm run preview
python3 -m unittest discover -s verification -p test_reference.py -v
```

E2Eは1ワーカーで実行。実物のiPhone/Android、VoiceOver/TalkBack、ユーザー試遊は自動ブラウザーテストと分けて記録します。

## 非公開候補のPC試遊

このPCで [候補試遊画面](http://localhost:4324/) を開き、候補を選んで遊べます。公開サイトとは別のローカル経路です。候補5問は未承認。実機スマートフォンの候補試遊と30問の品質確認は残っています。

```sh
npm run build:reviewer
python3 scripts/install-reviewer-agent.py
```

完了後の「この試遊を記録」または途中の「終了して試遊を記録」から結果と操作を確認し、JSONを書き出します。途中記録はそのrunを未完了で終了します。後で続けたい場合は一時停止を使います。ブラウザーの下書きやJSON書き出しだけでは台帳の承認に進みません。編集CLIへの取り込み・検証・停止/復旧手順は `docs/T22_EVIDENCE.md`。サーバーは127.0.0.1:4324だけで待ち受け、候補/seed/保存解を公開アセットへ入れません。

「在庫と試遊集計」で有効な公開待ちと、取り込み済みの初回/練習の完了率・未完了・時間を確認できます。7問未満は要対応、14問未満は警告。CLIで変更した後は「在庫を再確認」を押します。報告0件は未計測で、現在は候補5問・有効な公開待ち0問です（2026-10-13確認）。人間の品質受入・30問ストックは未完了。

```sh
npm run curate -- stock
node scripts/check-stock-live.ts
```

`stock` は台帳を変更せず、安全な集計だけをJSONで表示します。実装・検証の範囲は `docs/T22_STOCK_EVIDENCE.md`。

## 操作

ピース選択→回転→盤面の左上基準位置をタップ→「置く」。ドラッグでも配置できます。
キーボードはピースにTabで移動しEnter/Spaceで選択、盤面にTabで移動し矢印/R/Enter/Escで操作します。
無効な配置は盤面を変更しません。「戻す」はトレイへ、「取消」はプレビュー解除または前の確定配置へ戻します。

60秒後も続けられます。一時停止・別タブへの移動・再読込は中断として記録。再挑戦は練習runとなり初回記録を消しません。
ヒントの表示に成功した時だけ回数を増加。解答表示は完成として記録しません。保存拒否時も今回のプレイは続けられます。

## ファイルと進捗

- `SPEC.md`: ユーザー決定を反映した総合仕様。
- `AGENTS.md`: 作業ルール。
- `TASK.md`: 実装順序と進捗。
- `docs/DECISIONS.md`: 原資料との違い、依存・実装判断。
- `docs/M1_EVIDENCE.md`: 検証証跡と未確認。
- `packages/game-core/`: UI共通の純粋な幾何学判定、検査、ヒント用ソルバー。
- `packages/puzzle-tools/`: 非公開の小規模候補生成・一意性検証CLI。利用と独立照合の証跡は `docs/M2_EVIDENCE.md`。
- `npm run curate -- ...`: 非公開の幾何学重複・試遊/編集/公開待ち管理。手順と検証範囲は `docs/T21_EVIDENCE.md`。候補5問は未承認であり、正式日次版のストックではありません。
- `apps/web/`: 日英UI、Worker、端末内保存。
- `tests/e2e/`: 完遂、保存回復、排他、画面幅等。
- `examples/`、`verification/`: 設計ZIPの開発fixtureと独立Python照合。公開distへコピーしません。

`npm run build` は開発版のdistだけを作ります。PRIVATE解答・30問のバッチ・負例を混ぜないallowlist検査付き。正式な公開ビルド/日次manifest/編集パイプラインはM2〜M4で追加します。

試遊の更新・常駐・復旧: `docs/PLAYTEST_OPERATIONS.md`。検証結果と未確認: `docs/PLAYTEST_EVIDENCE.md`。

公開を継続しながら進めた固定URL・共有の検証と配備記録: `docs/PUBLIC_SHARING_EVIDENCE.md`。

```sh
npm run check:sharing
npm run check:sharing -- https://onebox.formflow-ops.com
npm run check:history
npm run check:history -- https://onebox.formflow-ops.com
```

ローカル検査は検証用の配信を自動起動して終了時に停止します。共有/clipboardの成否は模擬し、実OSの共有先やクリップボードを書き換えません。利用者の操作ではブラウザー対応に応じた共有、コピー、手動選択を用意します。

履歴はこのブラウザーに残る固定問題のrunを開始日時順に最大7回表示します。練習は1回ずつ数え、操作練習・別問題・壊れた記録を除きます。履歴を開くと進行中のプレイを一時停止します。時間非表示と不確かな時計を尊重し、保存できなければ一時記録の警告を出します。次回の日次配信日時は未定です。検証範囲と残件は `docs/PUBLIC_HISTORY_EVIDENCE.md` と `TASK.md`。

2026-10-14のバグ修正・残件対応: 公開固定版はrelease.jsonとcanonical JSON/hashを照合してから開始します。初版の自動集計は不採用です。非公開の日次準備は `npm run daily -- status` / `prepare`。準備には有効な品質在庫30問が必要で、現状0問のため停止します。配信commit/定時起動・正式日次UIは未完了。

E2Eは専用4320に毎回新しい開発サーバーを起動し、旧4319のpreviewを再利用しません。publicビルドの検査は `node scripts/check-release.mjs`、private HTTPSは `npm run test:review-https` と `node scripts/check-review-https.mjs`。

## GitHub公開範囲

ソース・仕様・設計用fixtureを公開します。認証情報、`content/private/` の実候補・台帳、`var/`、配信生成物、`evidence/` のローカル証跡、`*.PRIVATE.*` の保存解答はGit対象外です。テスト用解答は上記の準備コマンドで設計fixtureから端末内に再生成します。文書から参照するローカル証跡は、このリポジトリには含みません。
