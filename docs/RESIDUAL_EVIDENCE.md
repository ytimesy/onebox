# 2026-10-14 残件対応・バグ検査

公開版 https://onebox.formflow-ops.com/ja/ をこのPCで更新。全残件の完了ではなく、以下の実装/不具合修正と、実機/品質/配信commitの残件を区別する。

## 修正と実装

- レビューの状態遷移: 他候補の試遊/承認/queueだけで先行レビューが古い扱いになっていた。v2は承認イベントの単調増加orderで先行問を固定。候補の集合/重複/公開履歴/試遊の変化は引き続き再検査。旧レビューを自動移行しない。実台帳は候補のみで変更なし。
- 記録消去: 別タブが古いrunを復活させる問題、ロック待ちの開始が消去後に進む問題を修正。非個人のclear-generationと開始generationでキャッシュ/保存/保留を止める。容量満杯でmarkerを書けない場合も消去して再試行。複数タブの検査は更新済みコード同士で、旧版JSを開いたままの全組合せを保証しない。
- 保存検査: 空run ID、終了状態と終了日時の不一致を共通validatorで拒否。既存の合成試遊fixtureには終了日時を付け、実際の終了操作に合わせた。
- 公開整合: `release.json` とcanonical `/puzzles/<hash>.json` を生成/配信。ID/purpose/rules/hashが一致するまで開始不可。破損/通信失敗は明示再試行。JSON10KB上限・参照欠損・未列挙未来JSONはbuild gateで拒否。固定版の日時/次回更新はnull。
- 日次準備: `daily status/prepare` を非公開に追加。現在の有効品質在庫30問・レビュー/重複/UTC当日/ID不変/一意性を要求し、最終payloadを独立Python2探索とhashで照合。PRIVATE計画を作るだけで公開/台帳を変更しない。実台帳はready0で停止。
- 候補のスマートフォン試遊: LAN IP:4325の認証gatewayを追加し、元の127.0.0.1:4324は維持。アクセスコード/安全なcookie/Host/Origin/no-store/読み取り専用proxyを検査。実際の端末選択を追加し、選択変更は本人の確認を解除する。認証画面のno-referrerでブラウザーのform POSTがOrigin:nullとなり拒否される不具合を発見し、gatewayだけsame-originへ修正。Origin検査を緩めず、他originへのreferrerを送らない。公共サイトのno-referrerは維持。
- 任意分析: 初版は不採用と整理。collector/匿名IDは未実装で対象外。人間の試遊/継続観測は別に行う。

## 検証

| 段階 | 結果 |
| --- | --- |
| 型/単体/ビルド | 型検査成功、単体59件/9ファイル成功。public/private allowlist・容量・hash検査成功 |
| 複数問題の在庫 | 同時刻/逆順queue、合成30問が同時に有効になることを検査。実台帳へ合成人間報告を入れない |
| E2E | 専用4320で新しいサーバーを毎回起動し93件成功（31×3エンジン、1.8分）。[fresh回帰](../evidence/residual-m1-fresh-regression.txt) |
| ローカル生成物 | 3エンジンでmanifest破損/hash不一致/不正rules/private purpose/通信失敗→開始停止/明示再試行に成功。欠損/余分なJSONのbuild拒否。[release-local](../evidence/release-local.txt)。日英の共有/履歴も3エンジンで成功 |
| サーバー境界 | public static、loopback reviewer、HTTPS gateway各1件の複合検査成功。認証前403、偽Host/Origin/cross-site、本文超過、非ASCIIコード、試行制限、cookie期限、POST非許可を確認 |
| PC候補画面 | 3エンジン15試遊フロー、本人確認/未完了/初回/練習/ヒント/中断・4幅・合成CLI取り込み・在庫再確認/取得失敗復旧に成功。[reviewer回帰](../evidence/residual-reviewer-regression.txt) |
| 導入済みHTTPS | 同じLAN待受へloopback送信元からnative TLSのCA/hostname検査、認証前403、当該leafのpinを使うChromiumの実フォーム/secure context/HttpOnly cookie/4幅/合成phone未完了JSONに成功。[HTTPS検査](../evidence/review-https-live.txt)。実端末の接続は未検証 |
| 公開HTTPS | 日英開始/ヒント/完遂/共有/履歴・4幅・同一hash、manifest/JSON/hash確認、異常をブラウザーで模擬した開始停止/再試行に成功。[release-public](../evidence/release-public.txt)、[公開操作](../evidence/public-smoke.txt)、[共有](../evidence/sharing-public.txt)、[履歴](../evidence/history-public.txt) |
| 公開境界 | 現行/旧assetsが200/SHA一致、private API/画面/専用assets/内部文書は404、実台帳と共用Cloudflare設定は不変。[境界](../evidence/history-public-boundary.json) |
| 依存 | npm auditの全依存とproduction両方で既知脆弱性0件。[全依存](../evidence/residual-full-audit.json)、[production](../evidence/residual-production-audit.json) |

初回のE2Eは4319の古いpreviewを再利用して、新しい消去テストが失敗した。実装確認として採用せず、専用4320/reuse禁止へ修正して全93件をやり直した。古いpreviewや他サービスは停止していない。公開英語履歴の検査は、初期の「Place」をヒント完了と誤認していたため「highlighted」を待つ指定へ修正し、再確認した。アプリを変えて結果を合わせていない。

HTTPSのLAN-to-self接続はTLSでタイムアウト。同じcert/待受をloopback送信元から検証し、ブラウザーは一時的なCONNECT経路を用いた。一般LAN/実端末を確認済みとはしない。既存のネットワーク/ファイアウォール/DNS/共用トンネルは変更しない。詳しくは [PRIVATE_PHONE_TRIAL.md](PRIVATE_PHONE_TRIAL.md)。

## 配備・実台帳

public release `m1-9f3ad077ead7`、digest `9f3ad077ead78154c912938b743e51de97fbb3ad6e969e1f1de4a5c01bc1e1b2`。JS+CSS+Worker gzip89,261bytes、private reviewer89,005bytes。manifest/JSONは固定practiceのみで、payload hashは従来と同じ `b30042deab13615c3fb6c3c1082f7d457607ee9e0ffa82ba077d416f5406c9b3`。

ブラウザーで検証した同じ生成物をdigest一致でpromoteし、再buildなし。前版 `m1-f1119610d9e9` と古いassetsを保持。更新した配信スクリプトのためONEBOX webだけを再起動してhealth回復後にpromote。private reviewerと専用HTTPSも自分のagentだけ更新。既存のトンネルと他アプリは維持。

台帳はrevision1、候補5、人間報告0、承認0、有効公開待ち0、正式日次公開0でSHA不変。[daily状態](../evidence/daily-real-status.json)。合成30問・phone報告・OS共有mockを人間の実績や品質在庫へ数えない。

## 残るもの

- T30正式配信commit・台帳/公開履歴の一体更新・定時起動・正式日次UI/HTML/過去問題/撤回、T31/T32/T33の正式日次接続と次回時刻。private prepareを正式なpublisherとは呼ばない。
- T22品質確認済み30問。実端末のLAN接続/CA設定、人間の完遂・ヒント・未完了・迷いと編集承認。
- M1のiPhone/Android実物完遂、指ドラッグ/スクロール、VoiceOver/TalkBack、実OS共有。実機確認の依頼は継続中。
- PC全体の再起動・ログイン状態/物理停止からの復旧、複数地点、残る性能/セキュリティ受入。共用zoneのGoogle gateway挿入はCSPで3件ずつ遮断、実行/Cookie/計測応答は観測なし。完全な非挿入の受入は残す。
- 20人程度の操作観察と100初回/10〜14日以上の継続観測。自動試験を人間の参加人数へ数えない。M5は初版必須の残件ではない。
