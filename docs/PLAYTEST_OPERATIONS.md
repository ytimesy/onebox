# M1 HTTPS試遊の運用

このPCから固定1問を配信する限定試遊。日次版の一般公開・M4受入完了とは区別する。

- URL: https://onebox.formflow-ops.com/ja/ 、英語 https://onebox.formflow-ops.com/en/
- 固定URL: https://onebox.formflow-ops.com/ja/p/playtest-fixed-v1/ 、英語は `/en/p/playtest-fixed-v1/`。共有リンクの `?src=share` だけを追加で許可。未知slug/locale/クエリは404。
- 設定: `ops/playtest.json`。PUBLIC_ORIGINは同ファイルのpublic_originをLaunchAgentへ設定。
- origin: 127.0.0.1:4321、metrics: 127.0.0.1:4322。
- 専用トンネル: `onebox` / `41d0c50a-51f0-412f-8ea4-1f1e58e438ec`。
- 専用サービス: `local.onebox.web`、`local.onebox.tunnel`。ログはgit対象外の `var/`。
- 配信credentialは `~/.cloudflared/41d0c50a-51f0-412f-8ea4-1f1e58e438ec.json`。git・証跡・公開領域へコピーしない。
- `ops/tunnel.yml` はローカル専用でgit対象外。ingressは本ホスト→4321、残り404。共用config.ymlを読ませない。

## 更新

```sh
npm run test:server
npm test
npm run build:playtest
ONEBOX_SERVE_ROOT="$PWD/dist-playtest" ONEBOX_PORT=4323 node scripts/static-server.mjs
# 別ターミナル
npm run check:playtest -- http://127.0.0.1:4323
# 成功した同じ生成物のdigestを指定。promotion時に再ビルドしない。
npm run promote:playtest -- <buildが表示した64文字のdigest>
npm run check:playtest -- https://onebox.formflow-ops.com
```

公開前はallowlist/PRIVATE検査、型検査、ブラウザー確認を行う。`promote`はdigest一致を検査し、不変releaseへ保存して `var/current` を原子的に切り替える。旧ハッシュ付きJS/CSS/Workerは `var/assets` に保持し、読み込み済みタブから利用できる。日次問題のrelease.json/manifestはまだない。問題の内容変更は新しいIDで行う。

2026-10-13以降はビルド時に日英トップ/固定ページのHTMLと、汎用紹介PNGも生成する。PNGはブランド文字と4色矩形だけで解答を含まない。公開allowlistはこの5つのHTML・JS/CSS・hash付きonebox-cover PNGへ限定。PNGも旧assetsと同様に保持する。新しいビルドは `npm run check:sharing`、反映後は `npm run check:sharing -- https://onebox.formflow-ops.com` で固定URLと共有/画像の経路も検査する。

配信スクリプトを変更した場合は、同じ生成物の検証後に `launchctl kickstart -k gui/$(id -u)/local.onebox.web` でONEBOX webだけを再読込し、health回復を確認してpromoteする。新serverは旧単一HTML版にも対応し、既知の同じ固定問題だけ旧indexへフォールバックする。未知slugを正常なゲームへ転送しない。server更新時は短い再起動区間があり、配信の無停止保証とは扱わない。トンネル/他アプリを再起動せず、secret/shared configを変更しない。

## 常駐・回復

`python3 scripts/install-playtest-agents.py` は、検証済みreleaseと専用tunnel.ymlがある場合にONEBOXの2つだけを登録する。同名サービスが別projectのものなら中止する。

```sh
launchctl print gui/$(id -u)/local.onebox.web
launchctl print gui/$(id -u)/local.onebox.tunnel
curl --fail http://127.0.0.1:4321/health
curl --fail https://onebox.formflow-ops.com/health
launchctl kickstart -k gui/$(id -u)/local.onebox.web
launchctl kickstart -k gui/$(id -u)/local.onebox.tunnel
```

RunAtLoad/KeepAliveによる、ログイン時の起動とプロセス終了後の再起動。PCの物理再起動・未ログイン時・スリープ中の稼働は未検証。PC停止/回線停止中の新規アクセス継続を保証しない。読み込み済み画面の通信断完遂はM1で自動検証済み。`/health` はindexが読めなければ503。

停止が必要な場合は対象の2つだけをbootoutする。共用cloudflared service、他アプリ、DNSは触らない。

```sh
launchctl bootout gui/$(id -u)/local.onebox.web
launchctl bootout gui/$(id -u)/local.onebox.tunnel
```

更新後の復旧は、`var/previous` がある場合にそのリンク先へ `var/next` を作って `var/current` へrenameする。初回releaseにはpreviousは存在しない。切替後にローカル/public health・開始/ヒント/完成を再確認する。進行中タブの強制再読込やlocalStorage消去は行わない。ログは手動保守で、無期限運用前にローテーションを追加する。

## ヘッダー・計測

HTMLはno-cache/no-transform、ハッシュ付きassetsはimmutable。CSPはスクリプトのパスを `/assets/` に限定し、外部タグ・inline・同一originの計測loaderも許可しない。Workerはself、frame-ancestorsはnone。秘密/開発資料/未公開slugは実際の404。

共用ドメインのGoogle tag gatewayがHTMLへタグを自動挿入することを公開ブラウザーで検出した。no-transformでCloudflare Web Analyticsの挿入は抑止できたが、Google gatewayのタグは残る。CSPを広げず、その同一origin loaderを含めて遮断する。タグが実行されないこと、計測の応答・Cookieがないことを公開smokeで検査する。CSP違反0件とは報告しない。

根拠: [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)、[Google tag gateway](https://developers.cloudflare.com/google-tag-gateway/)。後者はsubdomain単位のConfiguration Rulesでtag injectionを無効化できないと記載。共用zoneの設定変更は既存サービスへ影響するため行っていない。正式公開前に完全なタグ非挿入を満たす配信経路を再検討する。

アプリはプレイ記録をサーバーへ送らない。配信事業者のアクセスログ・ネットワーク診断は別であり、IPを一切扱わないとは表示しない。originはアクセス/操作の個別ログを保存しない。トンネル接続ログはローカルvar内に保持する。
