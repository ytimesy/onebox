# 固定URL・結果共有の公開証跡

2026-10-13（JST）。ユーザーの「本番用に公開しつつ、実装を進めて」を根拠に、このPCの公開環境を維持しながらT31/T32の固定practice部分を追加して反映した。正式日次版の品質・本番受入は未完了。

## 公開された動作

- トップ: https://onebox.formflow-ops.com/ja/ と `/en/`。
- 固定URL: https://onebox.formflow-ops.com/ja/p/playtest-fixed-v1/ と `/en/p/playtest-fixed-v1/`。共有リンクは `?src=share`。
- 同じID/hashの固定practiceを配信し、言語切替や翌日の再読み込みで別問題に変えない。日次準備中を表示し、日次スコアや初回の公式記録を装わない。
- 日英の静的HTMLにlang/title/description/canonical/hreflang/OGを生成。クエリをcanonicalやHTMLへ挿入しない。紹介PNGは4色矩形と文字だけで盤面/ピース/解答はない。
- 完成結果から「この問題を友達に送る」で共有テキストを確認。Web Share/canShareの対応に応じて共有先選択、テキスト＋URLコピー、手動選択、クライアント生成PNG保存を提供。
- 練習/ヒント/中断/自己記録を共有文へ保持。時間非表示や不確かな時計なら画像・テキスト両方から時間を省く。run_id、個人ID、解答配置、操作順を共有URL/文/画像へ含めない。
- 共有キャンセルは通常の終了。APIの成功は共有先への引き渡しと説明し、SNS投稿完了と呼ばない。コピーやCanvas失敗時も選択可能なテキストを残す。
- 未完了/解答表示/操作練習/非公開候補を公開結果として共有しない。未知slug/locale、候補URL、不正/重複src/追加クエリは真の404。

## 検証

| 確認 | 結果と証跡 |
| --- | --- |
| 型検査 | `npm run typecheck`、public/privateビルドで成功 |
| 単体 | `npm test` 48件成功。追加4件で公開URL/安全な結果フィールド、非表示/uncertain時間の省略、未完了/非公開候補等の拒否、URL許可境界を確認 |
| 公開サーバー | `npm run test:server` 1件成功。日英トップ/固定URL/厳密クエリ/404、汎用PNGのMIME/cache、CSP・GET/HEAD・realpath境界・旧形式への対応 |
| M1回帰 | `npm run test:e2e` 87件成功（29×3エンジン）。[../evidence/sharing-m1-regression.txt](../evidence/sharing-m1-regression.txt) |
| 検証済み公開生成物の共有 | `node scripts/check-sharing.mjs`、Chromium/Firefox/WebKit×日英6フロー成功。固定URLから完遂、静的メタデータ/OG、共有のキャンセル/引き渡し/拒否、コピーの拒否/成功、非対応、画像保存/失敗、時間非表示、4幅、言語/翌日hashを確認。[../evidence/sharing-local.txt](../evidence/sharing-local.txt) |
| 公開stageの既存操作 | 検証用サーバーで `scripts/check-playtest.mjs`、3エンジン×日英6フロー成功。開始・ヒント・タッチ相当の完遂・practice保存・CSP・4幅。[../evidence/playtest-local-smoke.txt](../evidence/playtest-local-smoke.txt) |
| PC候補試遊回帰 | `npm run build:reviewer` と `npm run check:reviewer` 成功。3エンジン15試遊フロー、在庫/再確認/失敗復旧も成功。実台帳不変。[../evidence/sharing-reviewer-regression.txt](../evidence/sharing-reviewer-regression.txt) |
| 公開HTTPSの共有 | `node scripts/check-sharing.mjs https://onebox.formflow-ops.com`、Chromium日英2フロー成功。固定URL・完遂・共有画面・PNG・4幅・言語/翌日hash・404。[../evidence/sharing-public.txt](../evidence/sharing-public.txt) |
| 公開HTTPSの通常トップ | `npm run check:playtest -- https://onebox.formflow-ops.com`、Chromium日英2フロー成功。開始/ヒント/完遂、保存・4幅・CSP、日英同一hash。[../evidence/public-smoke.txt](../evidence/public-smoke.txt) |
| 配備/非公開境界 | 現行/旧releaseの全public assetsが200/SHA一致。private API/画面/専用assets404。実台帳と共用Cloudflare設定維持。[../evidence/sharing-public-boundary.json](../evidence/sharing-public-boundary.json) |

payload hashはすべて `b30042deab13615c3fb6c3c1082f7d457607ee9e0ffa82ba077d416f5406c9b3`。時差はAsia/TokyoとAmerica/Los_Angelesのブラウザー設定、翌日は壁時計を完成後に変更して再読み込みした自動確認であり、別地点や実際の数日間の観測ではない。

OS共有/canShare/clipboardのAPI成否は模擬し、実際のOS共有先やクリップボードへ送信していない。CanvasによるPNG生成・ダウンロードは実ブラウザーで検証。SNS投稿、実物スマートフォン、VoiceOver/TalkBack、人間試遊の証跡へ読み替えない。初版の検査スクリプトで開始ボタンのアイコンを含む表示名とexact指定が食い違いtimeoutとなったため、既存ボタンに一致する指定へ修正して全6フローを再実行した。アプリを変更して回避したものではない。

共有PNGと紹介PNGも目視。時間非表示の結果画像は [../evidence/share-result-no-time.png](../evidence/share-result-no-time.png)、画面は [../evidence/sharing-local.png](../evidence/sharing-local.png) と [../evidence/sharing-public.png](../evidence/sharing-public.png)。実際の公開済み固定問題の証跡であり、未来候補の画像は入れていない。

## 配備

public release: `m1-d08d7b1644af`、digest `d08d7b1644afd2217cf5066a358be85c47ac0fd5379201eacb1ed2026f03cd56`。JS+CSS+Worker gzip86,586 bytes。紹介PNG `onebox-cover-004e91814c57.png` は48,273 bytes、1200×630px。結果PNGは1200×800pxでクライアント内だけで生成する。

同じdistをブラウザー検証した後にdigest一致でpromoteし、反映時に再buildしていない。旧release `m1-fe2cd38642c2` はvar/previousに保持。旧JS/CSS/Workerもvar/assetsへ保持し、各ファイルのHTTPS hash一致を確認した。復旧手順は [PLAYTEST_OPERATIONS.md](PLAYTEST_OPERATIONS.md)。旧単一HTML形式へ戻した時も既知の同じ固定リンクはindexから遊べるが、旧版の静的メタデータは旧形式になる。

配信スクリプト更新により `local.onebox.web` だけをkickstartし、health回復を確認後にpromote。web PID5382、tunnel PID14063、reviewer PID75322。トンネルと共用設定、他アプリは変更していない。private reviewerはvar/reviewerへ別ビルド（gzip88,376 bytes）、公開へコピーしない。

実台帳はrevision1、候補5、試遊報告0、承認0、公開待ち0。今回の公開更新・自動の確認チェック・紹介画像をT22の品質30問として数えない。

## 未完了

日次manifest・更新・正式公開履歴・撤回処理、品質確認済み30問、M1実機/支援技術、人間の品質評価、実OS共有/投稿、T33の履歴/次回更新、M4正式な日次版受入は残る。公開環境の固定版を継続して動かしながら、非公開のスマートフォン候補試遊と品質記録・日次供給の接続を進める。

共用zoneの既知Google gateway挿入は引き続きCSPで遮断。公開トップで既知遮断3件ずつ、タグ実行・Cookie・計測応答は観測なし。完全なタグ非挿入/CSP違反0件の受入とは呼ばない。PC物理停止/再起動・実数日間の継続も今回未検証。
