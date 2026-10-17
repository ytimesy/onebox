# 公開・運用・復旧
## 2026-10-17 正式日次の運用（最新）

公開テスト/設計例のseedを本番の未公開候補へ転用せず、本番候補のseedを公開ソース/テストへ載せない。公開済みのseedから再現できる候補を見つけた場合は、元の問題/試遊/履歴を保持してrejectの監査記録を追加し、今後の配信対象から外す。公開履歴の書換えや保存解の削除で対応しない。

ユーザーが試遊確認のスキップを明示したため、下記の旧記述の人間試遊待ちによる公開停止は現在の公開条件ではない。人間の試遊/実機/難易度受入は未実施のまま。機械検証ポリシーは `ops/production-policy.json`、本番PRIVATE履歴は `var/production/snapshots/<hash>/state.PRIVATE.json`。従来のcuration/mainとhuman_review_inventoryは別であり、人間承認を自動登録しない。

```sh
python3 scripts/prepare-test-fixture.py
npm run build:playtest
npm run build:production
npm run test:production
ONEBOX_ALL_ENGINES=1 npm run production -- publish
npm run check:production -- var/current https://onebox.formflow-ops.com
python3 scripts/install-production-agent.py
npm run production -- status
```

publishは初回30問以上の実候補の機械検証を要求し、UTC当日だけを公開する。2回目以降は未使用候補から1問を選択。同日は何度呼んでも同じ問題で、停止中の日の問題は遡及作成しない。公開JSONはJSと独立Python2探索で照合する。PRIVATE台帳/既存の公開履歴/公開データを同じsnapshotへ保存し、localhostの新しいサーバーと使い捨てブラウザーで日英開始/完遂/保存/通信断完遂/共有/境界を確認してから、同じdigestへ原子的に切り替える。ソース台帳hash・旧head・UTC日付が変われば切替を拒否する。未来の問題JSON・候補APIを配信しない。

専用PCローカルLaunchAgent `local.onebox.daily` は60秒間隔/ログイン時にUTC日付を確認する。外部ジョブではなく、既存Web/tunnel/reviewerは別サービス。ログはvar/local.onebox.daily.logと.error.log。PC停止・スリープ中の更新や新規アクセス継続は保証しない。実時刻境界での翌日稼働と物理再起動は別途観測する。残り候補はproduction statusで確認し、枯渇前に既存生成/編集CLIで補充する。候補枯渇時は古い版を日付付き練習へ退避し、同じsourceを別日に再利用しない。

アプリ更新はbuild:production→test:production→production refresh→公開HTTPS確認。同じ当日ID/hashとPRIVATE履歴を保持してbundleを更新する。`production recall onebox-YYYY-MM-DD` は撤回記録を保持し、固定URL410/JSON404へ切り替える。全撤回時はトップ503。再公開/書換えはせず、後日別IDで公開する。事前検証に失敗したstagedディレクトリは非公開のまま残る。

書き込みロックはvar/production/write.lock。クラッシュで残った場合はownerのPIDとプロセスを確認し、稼働中のwriterがないことを確かめてから手動復旧する。自動で古いロックを奪わない。復旧でデータを削除せず、旧snapshot/旧assetsを保持する。

切戻しはまず `launchctl bootout gui/$(id -u)/local.onebox.daily` でONEBOXの日次更新だけを停止し、var/previousが指す検証済みsnapshotのdigestを確認してから、別名symlink→renameでvar/currentを戻す。公共Webはsnapshotルートを追従し、旧固定版への切戻しも対応する。旧問題/共有URLの不変性が必要なため、snapshotを物理削除しない。自動更新を戻す前に現行manifest/PRIVATE履歴の対応を確認する。

この文書は原設計の運用案。PC本番へのユーザー決定はSPEC.md/TASK.mdを優先する。M1試遊経路の実際の運用はPLAYTEST_OPERATIONS.mdを参照。公開URLの作成はユーザー依頼済みで、追加の承認を求めない。

## 公開前条件
このPCでの配信・公開URL作成はユーザー承認済み。新規有料契約・課金変更・既存サービスへ影響するインフラ変更が必要な場合は別途確認する。
本パッケージ自体はDNS/アカウント/サーバー/広告を変更していない。
Mac miniではCPU1ジョブを基本とし、LLM/動画生成と競合する大量ジョブを走らせない。

## 日次公開
更新予定はUTC 00:00 / JST 09:00。
Mac miniの定時ジョブまたは所有者が承認したCIで公開を起動する。実装時にどちらか1つを主系として決める。
30問のストックは非公開。公開済み当日分だけを新しい公開bundleへ入れ、未来分や解答を一括アップしない。
定時にジョブが起動しても配信確認までの遅れはあり得る。利用者に虚偽の更新時刻を表示しない。

1. 次の問題が編集承認済みか確認。
2. 解数、幾何学、重複、ハッシュ、データ契約を再検査。
3. 公開済みアセットを保持して、新しい不変JSON/HTML/OGを作成。
4. 問題の利用可能性を確認できる単位でrelease.jsonを切り替える。manifestだけ先に出さない。
5. /ja/ /en/ 当日固定URL 過去固定URL JSONを読み、ハッシュと開始可能性を確認。
6. 公開ログに日時・ID・hash・実行者/ジョブ・検査結果を保存。

キャッシュ設定の反映と公開切替の整合はstagingで試験する。世界中の全地点に完全同時配信する保証は付けない。

## 障害時
- PC停止: 新規アクセスの継続は保証しない。読み込み済みの問題は通信断でも完成可能。復旧後はローカル/HTTPS healthと開始・完成を確認する。原設計の「PC停止中の新規アクセス継続」は採用しない。
- 生成失敗: ストックを使用。未検証の代替問題をLLMで即興生成しない。
- ストック不足: 過去版を「練習」と明記して提供し、今日の新作と偽らない。
- manifest取得失敗: 取得済み版を日時付きで使う。未取得なら再試行と固定の練習を案内する。
- 問題破損/不整合: 開始を止め、その問題だけ利用不可。過去問題を巻き込まない。
- /collect障害/料金上限: 集計を停止。ゲームの静的配信は継続。

## ロールバック
公開済み問題の内容を同じIDで書き換えない。撤回ID一覧に入れ、訂正版は別ID。
過去結果は元のIDとハッシュを保持。撤回した問題は公式比較対象が存在する将来版でも集計から分離する。
誤ったアプリbundleは前のbundleへ戻し、そのbundleで対応できないrules_versionを開始させない。
現在進行中の画面へ強制再読込をかけない。

## 費用と負荷
静的アセット無料枠と動的Worker/DB/ビルド/ドメイン等は分けて見積もる。[S5]
動的な詳細計測を全アクセスで動かせば、静的ゲームでも別の使用量が生じる。
計測の停止フラグ、レート制限、日次集計、所有者への使用量レポートを用意する。
費用の上限通知が請求の厳密なハード上限になるとは仮定しない。
同時アクセスの実測前に「100万人対応」と表示しない。本番負荷試験は禁止し、承認済みstagingで行う。

## dailyvideo連携（後段）
既存実装を調査するまではAPIがあると仮定しない。初版からコード変更しない。
最初の連携はゲームのデモ画面を使った5〜10秒程度の録画素材をファイルとして書き出すところまで。
問題JSON/リプレイから、実際に動くゲームをPlaywright等で撮影する案を基本とし、LLMで存在しないゲーム映像を捏造しない。
当日の解答は宣伝素材に含めない。専用デモ問題か終了済み問題を使い、URLは実際に遊べる該当問題へ。
X/TikTok/YouTubeの投稿方式と規約は、連携実装時に公式情報・既存設定を確認する。今回は投稿操作を行わない。

## 2026-10-17 今回の安全なローカル確認

今回のユーザー指示では本番反映・公開ファイル変更・DNS/課金/外部ジョブ有効化を行わない。`promote:playtest`、LaunchAgentインストール/再起動、トンネル変更は実行しない。固定公開候補は `npm run build:playtest` までとし、dist-playtestは配信中のvar/currentとは別。

日次の主系候補はこのPCの専用単一ジョブ（UTC00:00/JST09:00）。今回は設定/有効化を行わず、実行スクリプトに品質在庫30問・独立検証・固定URL保持・公開確認のゲートが必要。private prepareは引き続き在庫不足で停止する。正式な日次公開commit/台帳更新/withdrawal/全過去アーカイブ/定時実行は未完了。

```sh
npm run build:daily-preview
npm run test:daily-preview
npm run serve:daily-preview
```

http://127.0.0.1:4327/ja/ と /en/、固定URL `/ja/p/onebox-2026-10-16/`、`/ja/p/onebox-2026-10-17/` は合成データによるローカル検証専用。`evidence/daily-preview/` は公開対象外、`.LOCAL_SIMULATION` の一致がなければサーバー起動不可。固定版のpromoteはdaily stageを拒否する。一般公開/実在庫への転用は禁止。

検証スクリプトは一時ディレクトリと専用ブラウザーを使う。新payload/HTMLを先に置く→manifestをrenameで切替→過去固定URL/hashを確認→元manifestへ復旧する。検証後は一時サーバー/ディレクトリを片付け、実台帳や公開symlinkを触らない。本番のロールバックを実施した証跡とは扱わない。

定時設定の安全な下書き（**未インストール**、PCのタイムゾーンがAsia/Tokyoの場合）。正式commitが未実装のため、以下は状態確認しか行わない。これを日次公開ジョブの完成とは扱わない。

```xml
<dict>
  <key>Label</key><string>local.onebox.daily-status.example</string>
  <key>WorkingDirectory</key><string>/Users/ytimesy/projects/onebox</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>packages/puzzle-tools/daily-cli.ts</string>
    <string>status</string>
  </array>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
</dict>
```

実際の主系へ接続する前にNodeパス・PCのタイムゾーン・品質在庫・非公開保存先を確認し、正式commit/公開履歴/撤回/復旧とHTTPS受入を実装する。今回この設定をlaunchctlへ登録しない。

## 最新許可による通常の本番反映

同日のユーザー継続許可により、本番反映の一時禁止を解除した。今後はAGENTS.mdの最新方針に従い、修正後に検証済みの同じ成果物を本番へpromoteし、HTTPSで確認する。今回は固定practiceとX投稿導線を反映済み。上記ローカル限定の合成daily-previewや未承認候補は引き続き公開しない。公開記録はREVISION_REPORT_20261017.md末尾を参照。
## 2026-10-17 継続開発: 履歴/復帰の確認

最新の本番反映許可に従い、共通コードの固定playtestビルドを検証した同じdigestから本番へ反映する。daily-previewの合成fixture、未来候補、PRIVATE台帳/解答は公開しない。日次の定時ジョブは有効化せず、実在庫の品質30問ゲートを維持する。

`npm run build:daily-preview` → `ONEBOX_DAILY_EVIDENCE=evidence/daily-history-20261017 npm run test:daily-preview` で日英×3ブラウザーの複数問履歴・通信断・撤回・6幅を検証する。証跡の出力先は環境変数未指定なら `evidence/daily-check/`。日次検証は専用一時ルート/空きloopbackポートを使い、本番へ異常なmanifestを送らない。

手動ローカル確認は `npm run serve:daily-preview` の http://127.0.0.1:4327/ja/ 。既存待受がある場合は停止せず、ONEBOXの同じ検証サーバーか確認する。最終の固定版digest・HTTPS確認・未完了は `DAILY_HISTORY_EVIDENCE_20261017.md` を参照する。

## 日次計画の再検証と非公開リハーサル（2026-10-17）

実在庫0の間は `npm run daily -- status` がblockedを返し、`prepare`は30問条件で停止する。`publication_implemented:false` と `local_atomic_rehearsal_implemented:true` を区別する。本番の日次ジョブは有効化しない。

品質条件を満たしたPRIVATE計画について、`npm run daily -- verify --name <計画名>` で現在の台帳から再検証できる。`rehearse --name <計画名> --rehearsal <新しい検証名>` は空の公開履歴からコピー台帳で初回切替を検証する。`inspect-rehearsal --rehearsal <検証名>` は有効なsnapshotを読取り、`commit-rehearsal --name <計画名> --rehearsal <検証名> --head <確認済みhash>` は未採用計画の再試行/同じ計画の再実行を検証する。`--workspace` は元のPRIVATE台帳の選択、`--previous-name` は前回の検証領域名で、実際にcommit済みのmanifestを読む。未実行の前回計画だけで公開済みとは判定しない。

出力はevidence/daily-rehearsals配下だけ。実台帳やvar/currentを更新しない。異常終了時はinspectで旧版の整合を確認し、プロセスとowner.jsonを調べる。残ったwriter.lockを自動削除せず、元の領域を保持して新しい検証名でやり直す。物理PC停止/正式日次の復旧は別の未完了受入とする。

`npm run build:daily-preview` → `npm run check:daily-rehearsal` は、使い捨ての合成台帳とloopbackサーバーで日英×3ブラウザーの完遂/保存/履歴まで検査し、その後に検証用currentを切り替える。合成のhuman_reportをmainへ取り込まない。詳細は `DAILY_COMMIT_EVIDENCE_20261017.md`。

## 非公開日次の遅延・撤回・再確認（2026-10-17）

`inspect-rehearsal`で確認したhashを--headへ渡し、--actorと--reasonを必須にする。`delay-rehearsal --rehearsal <検証名> --head <hash> --actor <担当> --reason <理由>`で既存問題のまま遅延を記録する。`recall-rehearsal --rehearsal <検証名> --head <hash> --id <公開ID> --actor <担当> --reason <理由>`で撤回する。いずれも`npm run daily --`に続ける。旧snapshotと公開履歴を保持し、代替がなければunavailableにする。撤回した問題を同じ計画の再実行やdelayで復活させない。

レビューを更新したコピー台帳を読む場合だけ、`refresh-rehearsal --workspace <コピー台帳名> --rehearsal <検証名> --head <hash> --actor <担当> --reason <理由>`を使う。コピー台帳の公開履歴を検証領域と一致させる必要がある。mainや公開履歴0の元台帳をそのまま指定して検証履歴を消す操作は拒否する。再読込後も次のprepare/commitは30問/現行レビューの条件を満たす必要があり、自動承認はない。

`npm run build:daily-preview` → `ONEBOX_LIFECYCLE_EVIDENCE=evidence/daily-withdraw-20261017 npm run check:daily-lifecycle`で、複数日/遅延/全問撤回/新問再開のブラウザー検証を実行できる。合成32問と試遊記録は使い捨て領域だけに置き、実在庫へ入れない。専用空きloopbackポートを使い終了時に自分のサーバーだけを停止する。実日次の主系・公開ジョブは未実装/無効のまま。詳細は`DAILY_WITHDRAW_EVIDENCE_20261017.md`。

## 日次の開始前競合を検証する（2026-10-17）

`npm run build:daily-preview`の後、`ONEBOX_START_EVIDENCE=evidence/daily-start-20261017 npm run check:daily-start`を実行する。日英×3ブラウザーの36ケースで、開始待ちの更新/撤回/掲載不整合・通信失敗・再確認・記録消去・既存runの通信断再開を検証する。必要な切り分け時のみ`ONEBOX_START_ENGINE=chromium`等でエンジンを選ぶ。実行ごとに一時サーバー/合成fixture/専用ブラウザーを使い、実台帳と本番へ異常注入しない。

公開固定版は新しい日次確認APIに接続せず、既存の同じ専用経路へ検証済みの固定ビルドだけ反映する。日次の形式/保存v1/公開IDは変えず、定時ジョブは有効化しない。実行結果、失敗ログ、URL、残件は`DAILY_START_EVIDENCE_20261017.md`を参照する。

## 非公開アーカイブの検証と本番の起動確認（2026-10-17）

`npm run build:daily-preview`の後、`ONEBOX_ARCHIVE_EVIDENCE=evidence/daily-archive-20261017 npm run check:daily-archive`で、180件の旧snapshotから182件への更新・最古固定URL/完遂/共有/履歴/取得済み版/撤回を日英×3ブラウザーで検証する。切り分け時は`ONEBOX_ARCHIVE_ENGINE=chromium`等を指定できる。180件履歴はテスト専用の合成データで、実際の公開/品質在庫へ入れない。

`daily inspect-rehearsal`のarchive_countは参照索引の件数で、旧形式はnull。実際の公開実績ではない。新しい公開準備は完全なprevious-nameを指定し、索引付き計画とコピー台帳を同時に検証する。古いPRIVATE計画やsnapshotを上書き/削除しない。台帳500件等の上限で止まる場合は、過去sourceを消して通すことなく分割管理を別途実装する。

本番は専用`local.onebox.web`と`local.onebox.tunnel`、localhost4321のhealthで状態を確認する。既に稼働している場合は継続し、停止中なら既存の専用LaunchAgentだけを起動する。検証済み固定版をpromoteした後は、日英HTTPSの開始/完遂/保存とmanifest/JSON/hashを確認する。archive/合成daily-previewを現在の本番固定releaseへコピーせず、共有DNS/トンネル設定や他アプリを変更しない。正式日次の主系ジョブは無効のまま。結果は`DAILY_ARCHIVE_EVIDENCE_20261017.md`。
