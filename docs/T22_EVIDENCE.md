# T22: 候補を試すPC内の導線

2026-10-12。T22は部分着手。候補の人間試遊・難易度評価・30問の品質受入済みストックは未完了。

2026-10-13追記: 在庫警告と取り込み済み試遊集計を追加し、PC画面へ反映済み。最新の検証と残作業は [T22_STOCK_EVIDENCE.md](T22_STOCK_EVIDENCE.md)。以下は2026-10-12時点の試遊導線の記録。

## 実装と動作

- URL: http://localhost:4324/ 。このPC用、LAN/HTTPS公開用のbindは持たない。localhostと127.0.0.1ではブラウザーの記録が別なので、localhostへ統一して操作する。
- 台帳の未承認candidate/playtestingだけを選べる。棄却/承認/公開待ちを新しい試遊として扱わず、幾何学重複と一意性検査に通らない候補は開始用APIから返さない。
- 既存ゲームを再利用し、タップ/クリック・ドラッグ・キーボード、回転、取り消し、ヒント、再開を扱う。試遊中は候補の変更を止め、記録/一時停止後に変更できる。
- 初回・練習を区別し、ブラウザー下書きに全開始を残す。記録を閉じたり再挑戦した未完了runも一覧に残る。実際に置いてから取り消した場合は配置実績を保持する。解答を表示しただけの配置は人間が置いたピースに数えない。
- 途中の「終了して試遊を記録」はrunをabandonedで確定し、中断扱いにする。同じrunを後から完了に変えず、続けたい場合は一時停止を使い、記録済みの再挑戦は新しい練習runにする。完了後の「この試遊を記録」は中断にしない。完了/未完了、時間、ヒント、中断、言語、初回/練習、1ピース配置を表示し、操作方法と迷いを入力する。再読込した停止中runの記録はlease取得後に最新保存を読み直し、別runや別タブの進行を上書きしない。
- 実際に自分が操作したことの確認チェック後だけJSONをダウンロードできる。自動観測のkindはbrowser_observationで、書き出しはhuman_report。時計が不確か・不整合・時間/ヒント上限外なら書き出しを拒否する。端末はdesktop固定で、模擬画面をphoneとして申告しない。
- 書き出しと台帳取り込みは別。書き出しを中止したものを離脱0件として報告しない。localStorage障害時はこのページ内の下書きへ継続し、閉じる前に書き出すよう表示する。ページを閉じた場合の保存保証はない。

## 非公開境界

生成物は `var/reviewer/` に限定。公開release/var/assetsにはコピーしない。選択した問題のPuzzleとhashだけをローカルAPIから返し、台帳のsource・seed・構成解・保存検証解・編集メモを返さない。解法ヒントは既存Workerが選択問題から計算する。

サーバーはGET/HEADの読み取りのみ。Hostをlocalhost/127.0.0.1と現在の専用portへ限定し、異なるOrigin・cross-site要求を拒否する。CORSなし、no-store、no-referrer、nosniff、noindex、frame禁止のCSP。ファイルのallowlistとrealpath検査で台帳・文書・symlink escapeを配信しない。アクセス/操作/IPのログは持たず、エラー応答にもprivate parser内容を含めない。

PCを使える別の人への本人認証を提供したわけではない。人間の確認チェックは本人/実機の認証ではなく申告。スマートフォン用の非公開HTTPS経路は別途必要。現在の公開固定問題URLへ候補APIを追加していない。

## 起動・停止・復旧

```sh
npm run build:reviewer
python3 scripts/install-reviewer-agent.py
launchctl print gui/$(id -u)/local.onebox.reviewer
```

専用LaunchAgent `local.onebox.reviewer`、RunAtLoad/KeepAlive、127.0.0.1:4324。登録後のrunning/待受・候補5問のAPI/hashを確認。PC物理再起動や未ログインでの起動は今回未検証。公開web/tunnelのサービスとCloudflare共用設定は変更しない。

停止:

```sh
launchctl bootout gui/$(id -u)/local.onebox.reviewer
```

起動はinstallスクリプトを再実行する。プログラム更新後の再読込もこのreviewerだけをbootoutし、再登録する。公開web/tunnelや他アプリは対象にしない。手動起動する場合はreviewer agentの停止後に `npm run serve:reviewer`。ログは `var/local.onebox.reviewer.log` / `.error.log`、HTTPアクセスログなし。

## 人間が書き出した結果の取り込み

実際に操作したJSONだけを手動で取り込む。ブラウザーテストでチェックを入れた結果は、実台帳へ入れない。

```sh
npm run curate -- list
npm run curate -- start-trial --id candidate-35bad118a3d8 --actor reviewer
npm run curate -- record-trial --id candidate-35bad118a3d8 --actor reviewer --report '/実際に書き出したJSONのパス.json'
npm run curate -- inspect --id candidate-35bad118a3d8
```

idは遊んだ候補へ置き換える。candidateをplaytestingへ変える操作は人間試遊済みの証拠ではない。既にplaytestingならstart-trialを繰り返さない。trial_idはrun_idで、同じJSONの再取り込みを拒否する。未完了と練習も取り込み、初回の開始/完了/中央値を全体と分けて見る。今回はdesktopの記録だけなので、T21のスマートフォン完遂・編集承認ゲートを満たさない。

承認/公開待ちはT21の独立照合と現在の検査hash/警告確認を経る別操作。操作方法の報告はtouchがタップ/クリック、dragがドラッグ、keyboardがキーボードを表す。人間の試遊をCLIが自動認証したとは扱わない。

## 自動検証

```sh
npm run typecheck
npm test
npm run test:reviewer-server
npm run build:reviewer
npm run check:reviewer
npm run build
npm run test:e2e
npm run test:server
```

- 型検査成功。単体39件成功（観測/書き出しの5件追加）。確認チェック必須、完了の幾何学、初回/練習、未完了、配置後取消、解答表示、clock/hash/時間/ヒント境界を検証。`../evidence/t22-unit.log`。
- private配信境界1件成功。Host/Origin/cross-site拒否、GET/HEAD限定、no-store/no-CORS、返すフィールド、symlink/台帳の非配信、破損時の閉鎖、読み取り中の台帳不変を検証。`../evidence/t22-reviewer-server.txt`。
- Chromium/Firefox/WebKitそれぞれ5フロー成功。完遂→確認→JSON、初回保持と未完了練習、置いて取消後の配置実績/ヒント、reload/英語/解答表示、320/390/768/1440幅。JSON→既存CLI取り込みも使い捨て台帳で成功。実台帳が変わっていないことをhash比較。`../evidence/t22-reviewer-browser.txt`。
- 画面は `content/private/reviewer-evidence/` にのみ保存。使い捨ての合成候補であり、実際の候補5問の人間試遊ではない。320pxスクリーンショットも目視し、横はみ出しなしを確認。
- 既存M1ブラウザー回帰87件（29項目×3エンジン）を今回再実行して成功。固定問題のpublic配信境界1件も成功。`../evidence/t22-m1-regression.txt`、`../evidence/t22-server.txt`。
- 常駐実サーバーで候補5問のAPIがPuzzle/hashのみを返し、hash整合と台帳不変を確認。`../evidence/t22-live-reviewer.txt`。

## 現在の品質ゲート

実台帳: 候補5問、試遊報告0、承認0、公開待ち0、正式日次公開0。UIの完成、自動ブラウザーのhuman_report、同梱30問を品質確認済みストックへ数えない。新しい実候補は生成していない。

残る作業: 人間の候補試遊、安全なスマートフォン候補試遊HTTPS経路、実機の完遂/ドラッグ/支援技術、難易度・操作迷い・ヒント・未完了を含む品質評価、30問ストック、14/7問の在庫警告、M3日次公開との接続。T22/M1全体の完了チェックは付けない。

### 中間で見つかった問題

未完了報告を出した後に同じrunを継続できる状態では、取り込み済みのtrial_idと後の完了が食い違うため、記録操作でrunを終了するように変更。終了済み未完了に再開ボタンがなく、練習が別runになることを3エンジンで確認した。

中間のM1回帰はFirefoxの時計変更1件が失敗（86/87）。最初の描画callbackが開始時の時計基準を上書きするタイミングを修正し、時計変更を各エンジン3回、計9件で確認した。`../evidence/t22-clock-regression.txt`、修正前は `../evidence/t22-m1-regression-before-clock-fix.txt`。同時実行中に編集CLI単体試験の既定5秒timeoutも1件発生。上限を変更せず単独で再実行して39件成功。中間記録は `../evidence/t22-unit-timeout.txt`、最終は `../evidence/t22-unit.log`。

## 公開固定問題の更新

候補試遊用にゲーム部品を共通化し、時計変更検出を修正した固定問題を `m1-fe2cd38642c2` として反映。digest `fe2cd38642c25893bf99576c78297d2a2b265a625468efac5c69ee35c81d6027`、JS+CSS+Worker gzip84,351 bytes。レビュー用生成物はPC専用var/reviewer、gzip87,034 bytesで、公開releaseへコピーしていない。検証したdist-playtestをdigest一致で原子的にpromoteし、再buildしない。

ローカルの3エンジン×日英6フロー、HTTPSのChromium日英2フローとこのPCのChrome155.0.8059.39の日英2フローが成功。開始/ヒント/タッチ相当の完遂/練習/保存、320/390/768/1440幅、CSP、同一puzzle hashを確認。実物スマートフォンや人間の操作とは区別する。`../evidence/playtest-local-smoke.txt`、`../evidence/public-smoke.txt`、`../evidence/public-chrome-smoke.txt`。

最新HTMLのasset名、現行/旧releaseのassets200/hash一致、reviewerの画面/API/専用assetsが公開HTTPSで404、共用config hash維持を確認。`../evidence/t22-public-boundary.json`。配信web/tunnelは既存PID15396/14063を維持、reviewerは専用PID68326。共用zoneのGoogle gatewayによる既知CSP遮断3件は残り、タグ実行・Cookie・計測応答は観測なし。完全なタグ非挿入の正式受入は未達のまま。
