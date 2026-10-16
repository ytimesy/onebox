# M1 HTTPS試遊の検証結果

2026-10-12 JST。このPCから固定問題を配信する試遊版。ユーザーがスマートフォンで最初の1ピースを「置けた」と回答。一問完遂・端末別・支援技術・難易度、日次版のM4公開受入は未完了。

## 成果物

- 試遊URL: https://onebox.formflow-ops.com/ja/ 、https://onebox.formflow-ops.com/en/ 。HTTPSの公開ホストを使って検証した。異なる国・物理回線からの確認とは扱わない。
- `playtest-fixed-v1`、practiceのみ。UIに「固定問題・試遊版」。同梱fixtureと同じ形を使う限定試遊であり、品質受入済みの日次問題と扱わない。
- 専用サーバー `scripts/static-server.mjs`、独立Cloudflare Tunnel/LaunchAgents。配信/復旧手順は `PLAYTEST_OPERATIONS.md`。
- 型検査・dist allowlist/PRIVATE検査、digest照合後の原子的切替、旧ハッシュ付きassets保持。
- 現在のrelease: `m1-fe2cd38642c2`。生成物digest: `fe2cd38642c25893bf99576c78297d2a2b265a625468efac5c69ee35c81d6027`。JS+CSS+Worker gzip合計84,351 bytes。個別JSON/manifestの公開契約受入は未実装。T22の共通ゲーム部品と開始直後の時計変更検出を反映。以下のM1/T20表は過去の実行証跡で、最新の単体39件・回帰87件・時計変更9件・HTTPSの証跡は `T22_EVIDENCE.md` を参照。

## 実行と結果

| 確認 | コマンド・操作 | 結果・証跡 |
|---|---|---|
| 型・単体・build | `npm test` / `npm run build` / `npm run build:playtest` | 型/build成功、単体24件成功。試遊distは83,970 gzip bytes。`evidence/m2-unit.log` / `evidence/m2-playtest-build.txt` |
| 配信境界 | `npm run test:server` | 1件成功。HTML/JS/CSS、HEAD/405、不正URL/PRIVATE/シンボリックリンク拒否、CSPパス限定、公開CSPにlocalhost許可なし、health503。最新 `evidence/server-m2.txt` |
| M1全体回帰 | `ONEBOX_TEST_URL=http://127.0.0.1:4320 npm run test:e2e` | 29項目×3エンジン=87件成功。`evidence/e2e-m2.log`。補助lease所有権・旧タブ上書き抑止・320/390×568pxのtouch完遂を追加 |
| 試遊build | `node scripts/check-playtest.mjs http://127.0.0.1:4323` | Chromium/Firefox/WebKit各日英6フロー成功。開始/ヒント/タッチ相当完遂/practice保存/4幅/CSP。`evidence/playtest-local-smoke.txt` |
| HTTPS | `node scripts/check-playtest.mjs https://onebox.formflow-ops.com` | 日英2フロー成功。同じ問題hash、ヒント/完成/保存、320/390/768/1440px。`evidence/public-smoke.txt` |
| このPCのChrome | `ONEBOX_CHROME=1 node scripts/check-playtest.mjs https://onebox.formflow-ops.com` | インストール済みChrome155.0.8059.39で日英2フロー成功。自動操作であり、人間試遊・実物スマホとは別。`evidence/public-chrome-smoke.txt` / `evidence/installed-chrome-public.txt` |
| 常駐・復旧 | ONEBOX webへSIGTERM、KeepAlive後にPID/health再確認 | 初期PID14060から再起動、最終PID15396/runs4/exit0。local/public health200。専用tunnel接続4本。`evidence/onebox-operations.json` |
| 最新配備・旧アセット | promotion後のHTMLと更新前JS/CSS/Workerを公開経路から取得 | HTMLの最新asset名一致、旧各200/immutable/内容hash一致、local/public health200。既存web/tunnel PID15396/14063のまま。`evidence/m2-public-deployment.json` |
| 既存サービス分離 | 共用config SHA-256、既存tunnel状態 | 共用config変更なし。dailyvideo/imager/mstation接続4本を保持、worldseedsは元の停止状態0本。既存コード/DB/LaunchAgent変更なし |

公開経路のhealth/robotsは200、SPEC.md/PRIVATE解答/未実装manifest/未公開slugは404。Cloudflare独自エンドポイント全体がoriginのallowlistで制御できるとは扱わない。

スクリーンショット: `evidence/public-welcome-390.png`、`evidence/public-play-390.png`、`evidence/public-ja.png`、`evidence/public-en.png`。Chromeのヒント失敗時の画面は `evidence/native-chrome-hint-before.png`。

## 発見と修正

1. Cloudflareの共用zone設定がWeb Analytics/Google gatewayを自動挿入。no-transformでWeb Analyticsを抑止した。Google gatewayは残るため、script-srcをassetsパスへ限定し、その同一origin loaderもinlineも遮断。公開smokeでは既知のタグによるCSP遮断3件を観測した。gtag/dataLayer/first-party tagの実行状態はundefined、Cookieなし、計測応答なし。CSP違反0件・タグ非挿入を達成したとは報告しない。共用zone全体の設定は変えていない。
2. このPCのChromeでは旧Worker待機2.5秒に初期読み込みがかかり、ヒントが失敗。起動ready通知と探索結果を分け、初期読み込み6秒、ready後2.5秒へ修正。探索自体の1.5秒/10万node上限を維持。3秒のWorkerダウンロード遅延でも成功するE2E、Worker constructorがSecurityErrorでもゲームを続行できるE2Eを追加。最終Chrome HTTPS完遂で修正を確認した。
3. 配信用assets検査をWorkerの名前にあるdotへ対応。PRIVATEやsymlink escapeを拒否し、indexを読めないhealthは503にした。CSPで同一originだから安全と仮定せず、許可するスクリプトのパスを明記した。
4. Web Locks非対応環境で、期限切れ後に別タブが同じrunを継続した時、旧タブが保存時に上書きし得た。各保存時にも所有権を確認し、失効したページは共有状態を保存せず一時停止する。storageイベントを遅らせた旧タブの再開でも新しい2ピース配置が残ることを3エンジンで確認。所有権が読めないページはメモリー専用へ切り替える。Firefoxのtab closeでpagehideが届かない場合は4秒lease失効後の明示再開を確認。
5. 低いスマートフォンviewportで確定ボタンが画面外へ出ていた。短い画面だけ回転/置く/戻す/取消を下部固定、盤面を280pxまでにし、320×568/390×568のtouch完遂とボタンが画面内にあることを確認。ページスクロール・ピンチは禁止しない。`evidence/short-touch-playing-320.png` / `evidence/short-touch-playing-390.png`。

## ユーザーによる実機確認

前回は「まだ試していない」。今回、質問「スマートフォンで https://onebox.formflow-ops.com/ja/ を試した場合、最初の1ピースを置けましたか？」へ「置けた」と回答を得た。スマートフォンでの初期配置ができたことだけを記録する。機種・OS・ブラウザー・操作所要時間・一問完遂・指ドラッグの確認は含まない。協力者20人の観察や難易度評価として数えない。

## 残る確認

- 人間のスマートフォン初期配置は確認済み。一問完遂・実物iPhone/Androidの指ドラッグ・iOS Safari/Android Chrome・VoiceOver/TalkBack・難易度評価は未確認。
- デスクトップChromeはこのPCの実ブラウザーを自動操作した。Safari/Firefoxのインストール済み実ブラウザーの手動確認は残る。
- 非Web Locks環境の継続と旧所有者保存抑止は自動確認済み。全ての同時claim・実機サスペンド・ストレージ停止の競合を保証したとは扱わない。実機性能/p95、小標本からの評価、20人程度の操作観察は未確認。
- RunAtLoad/KeepAliveは登録・プロセス終了後の復旧を確認。PC物理再起動/停止/スリープ・未ログイン時・別回線からの確認、ロールバック実操作、ログローテーションは未確認。
- 完全なタグ非挿入、日次manifest/JSON/hashの公開検査、当日/過去固定共有URL、30問ストック、日次更新、共有画像は未実装。

T15/T40は部分完了のまま。初期配置の確認を受け、M2のT20限定CLIと非公開候補5問の独立機械検証へ進めた。`M2_EVIDENCE.md`を参照。M1全完了・T22の人間による品質受入・日次版公開とは扱わない。
