# 非公開スマートフォン試遊

2026-10-14。一般公開サイトとは別に、このPCと同じLANだけで使うHTTPS試遊gatewayを用意した。候補5問は未承認。実物スマートフォンの設定と試遊は本人の操作が必要で、未確認。

URL: **https://ishiisachionoMac-mini.local:4325/** 。PCと同じWi-Fi/LANで開く。外出先/モバイル回線/一般公開トンネルからは接続しない。IP直指定が必要なら `var/review-https/config.json` のbindを使う。

今回の確認では、PC自身のLANアドレスを送信元にするとTLSがタイムアウトした。同じ待受へ127.0.0.1を送信元にした接続では、CA/hostname照合と認証・書き出しを確認できた。Chromiumは一時的なloopback CONNECTを使った確認で、実端末からのLAN接続を証明しない。既存のネットワーク/ファイアウォール設定は変えていない。実機の接続・証明書設定は未確認のまま残す。

1. このPCの `var/review-https/ONEBOX-Local-Trial-CA.cer` を試遊端末へ自分で転送し、ONEBOX Local Trial CAとして設定する。秘密鍵（ca.key/server.key）は転送しない。iPhoneは証明書の手動インストール後にSSLの信頼設定も必要。[Appleの手順](https://support.apple.com/en-us/102390)に従う。Androidは機種によって異なるため、[Googleの証明書設定](https://support.google.com/pixelphone/answer/2844832?hl=ja)と当該機種の手順を確認する。設定が難しい場合はPC内試遊を使い、未設定端末の動作を確認済みとしない。
2. このPCの `var/review-https/access-code.txt` を開き、URLの画面に入力する。コードはURLへ入れず、ログ/公開文書に印字しない。
3. 候補を選んで試遊し、完成後の記録、または「終了して試遊を記録」を選ぶ。実際の端末・操作・迷いを選び、自分の操作と確認した場合だけJSONを書き出す。続けたい場合は一時停止を使う。
4. 書き出したJSONをPCへ自分で戻し、既存の `curate record-trial` で取り込む。書き出しだけでは台帳や承認へ反映されない。未完了/練習/ヒント/中断も含める。自動試験のphone報告を取り込まない。

利用後は必要に応じ、この試遊用CAの信頼/インストールを端末側で解除する。PC側のシステムKeychainへ自動追加していない。

## PC側の運用

`npm run install:review-https` は専用agentを準備/再起動し、LAN IPと90日有効のleaf証明書を更新する。CAは365日、既存CAとコードは保持。DHCPのIP変更・証明書期限前に実行して再確認する。CA自体の更新は端末の再設定が必要。更新中はこのgatewayが短時間停止し、sessionが無効になる。コードも変える場合は `npm run install:review-https -- --rotate-code`。他のagent/公共トンネルは変更しない。

専用agent: `local.onebox.reviewhttps`。ログは `var/review-https/service.log` と `error.log`。private TLSディレクトリ700、鍵/コード/設定/証明書600。停止はこのagentだけをdisable/bootout、再開はinstallコマンド。サーバーは私設LAN IP:4325へbindし、元のreviewerは127.0.0.1:4324のまま。

アクセスコードPOST、12時間のSecure/HttpOnly/SameSite=Strict cookie、Host/Origin/cross-site検査、1分5回/本文128bytesの制限、no-store、GET/HEADだけのloopback proxyを実装。認証前にprivate API/assetsを返さない。台帳変更/承認/サーバーへの報告送信は行わない。HTML/JS/APIとログにコード/秘密鍵/生成seed/保存解を含めない。

検査: `npm run test:review-https` と `node scripts/check-review-https.mjs`。後者はこのPCで認証・候補選択・未完了のphone JSONダウンロードを自動検査するが、本人の報告ではない。native TLSは当該CA/hostnameを検証し、Chromiumは当該leafだけをpinする。実物iPhone/AndroidのCA設定・実機の完遂・VoiceOver/TalkBackは未完了。
