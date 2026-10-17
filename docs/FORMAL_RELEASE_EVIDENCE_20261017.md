# 正式公開の依頼と品質試遊の準備（2026-10-17）

ユーザーが正式版の公開を依頼し、確認質問には「まだ試遊記録はない」と回答した。公開の再承認は不要だが、人間の品質評価・実機受入を済ませたと記録する根拠はない。現在は正式日次公開を実行していない。既存の固定1問の公開と専用Web/トンネルは維持する。

## 実施した処理

既存の仕様/AGENTS/TASK、ソース/テストと未コミット差分を確認し、生成CLI・編集CLI・PrivateStore・候補試遊サーバーを再利用した。新しいアプリや別の生成器は追加していない。

1. 作業前のprivate全20ファイルのhash、既存5候補の各レコードhash、公開履歴hash、在庫、配信先を `evidence/formal-release-20261017/before.json` へ記録。
2. `npm run puzzles -- generate` で10問ずつ3バッチを順次生成。実行したseedを含むコマンドと結果は非公開のgenerate-a/b/c.logに記録。各バッチは上限付きの既存生成器を使い、新規の再現可能な候補であって同梱fixtureの転用ではない。生成seed/保存解はprivateにだけ保持。
3. 新しい30問のJavaScript一意性検証に加え、Pythonのexact-cover/独立DFSで各1解とcanonical hashの一致を検査。回転/鏡映/ピース名を正規化した幾何学キーで、既存候補・公開履歴・公開固定practice・新候補間の重複がないことを確認。
4. 既存の `npm run curate -- import --batch release-trials-20261017-a --actor codex` とb/cを実行。各取り込みでもJS/Pythonによる機械検査を再実行。既存のロック/履歴付き原子的保存を使用し、revision1から4、候補5から35へ増加。人間報告/承認/公開待ちは追加せず、全35件をcandidateのまま保持。
5. 稼働中の非公開reviewerのAPIで35候補と取得内容hashを確認。初期画面の35選択肢・品質公開待ち0・pageerrorなしをChromiumで確認し、下書き/報告/承認を書き込んでいないことを台帳hashで確認。
6. 現在の実台帳で `daily prepare` を試行し、`30 currently eligible quality-reviewed puzzles required` でexit2、PRIVATE公開計画が作成されないことを確認。正式日次manifestへの切替・定時ジョブの有効化は行っていない。

試遊画面の最初の自動検査は、閉じたselect内のoptionをvisibleで待ったためtimeoutした。optionが存在することをattachedで検査し直して成功。アプリ実装の失敗や人間による試遊として数えていない。

## 結果と保存境界

| 項目 | 結果 |
| --- | --- |
| 新規30候補の一意性/参照解/hash | JSと独立Python2方式で成功 |
| 幾何学的重複 | 新規30・既存5・公開固定practiceとの重複なし |
| 実候補数 | 35、全件未試遊・未承認 |
| 人間の試遊報告/承認/品質公開待ち | 0/0/0。必要な品質公開待ちは30問 |
| 台帳revision | 4。既存5レコードと公開履歴は作業前と同一hash |
| 既存privateファイル | 既存20ファイルのうち、追記保存したmain/state.PRIVATE.jsonのみ更新。他の既存ファイルは同一hash。新バッチ3ファイル・台帳revision3件をprivateに追加 |
| 候補試遊API/画面 | 35選択肢・品質公開待ち0、pageerrorなし。自動確認であり人間/実機受入ではない |
| 正式日次の公開準備 | 品質30問条件で拒否、公開計画未作成 |
| 公開HTTPS | 日英トップ/health200、候補API/在庫API/privateバッチ404 |
| 本番配信 | 固定practiceのm1-2fa2ab0b3cbc、digest `2fa2ab0b3cbca06f648b8626e96bafe3247a8adb6c8b532638dc7342442d3083` を維持 |

証跡はbefore.json、candidate-preflight.json、after.json、release-gate.log、reviewer-ui.json、reviewer-35.png。既存未コミット変更と保存形式を保持。生成候補/保存解/未来問題を公開せず、他アプリ・DNS・共有インフラ・課金・外部ジョブを変更していない。今回は製品コードの変更がなく、既存CLIを実行した。前回の単体109件/E2E126件を今回再実行したとは報告しない。

## 人間の試遊と残件

このPCでの候補試遊は http://localhost:4324/ 。起動済みの `local.onebox.reviewer` を維持しており、35候補を選択できる。未完了の場合も「終了して試遊を記録」で終え、実際の端末/操作/迷いを記録し、本人の操作結果と確認した場合だけJSONを書き出す。書き出しは取り込み/承認ではない。既存CLIのstart-trial/record-trialと、チェックhash付きの編集承認/queueが必要。

スマートフォン候補試遊は [PRIVATE_PHONE_TRIAL.md](PRIVATE_PHONE_TRIAL.md) の非公開LAN HTTPSを使用し、CA設定と実物端末からの接続は本人の確認が必要。公開トンネルへ候補APIを接続しない。公開中の固定practiceは https://onebox.formflow-ops.com/ja/ で試せるが、それだけで新候補30問の品質受入にはならない。

正式公開には、人間による候補の品質評価と30問の承認、実物端末/支援技術等の受入に加え、本番の配信commit・実台帳/公開履歴との接続・定時更新・HTTPSの日英当日/過去URLの公開後確認が残る。現在の非公開リハーサルを本番publisherとして扱わず、名称だけを正式版へ変更しない。
