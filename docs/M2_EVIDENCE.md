# T20: 小規模候補生成と独立検証

2026-10-12 JST。このPCでTypeScript生成・検証CLIを実装。スマートフォンで最初の1ピースを置けたというユーザー回答を受け、T20の限定作業へ進めた。M1の一問完遂・端末別操作・人間による難易度評価は未完了。

## 実装と利用

`packages/puzzle-tools/generator.ts` は18種の片面pentominoを列挙し、鏡映も含めて異なる4形を選ぶ。回転/平行移動で重ならない完成配置を作り、残り5マスを固定、空き20マスの連結性を検査する。共有ゲームコアで完成を確認し、問題JSONから別途一意性を探索する。

`packages/puzzle-tools/cli.ts` はNode24.6.0で直接実行。TypeScript MRV探索、Python exact-cover、Python独立固定順DFSを照合する。0解・複数解・打切り・契約不整合を拒否し、探索完了の1解だけを候補として採用する。1解発見後に上限へ達したケースもunknownとして拒否する。

```sh
# 同じbatch名は再使用できない。生成物は非公開ディレクトリだけへ出力。
npm run puzzles -- generate --seed 123 --batch example-new-batch --count 5
npm run puzzles -- verify examples/sample_puzzle.json
python3 verification/check_candidates.py content/private/candidates/example-new-batch/batch.PRIVATE.json
```

生成上限は10問/2万候補/総計15秒。既定ソルバー上限は10万ノード/1.5秒（設定最大100万ノード/5秒、総計の残り時間でも制限）。候補不足はpartialの非公開レポートと終了コード1。verifyの終了コードは一意解0、0解/複数解/不明1、契約不正2。JSONは10KBまで。標準出力へseed・構成解・検証解は出さない。

CLIの生成先は `content/private/candidates/<safe-name>/batch.PRIVATE.json` のみ。ディレクトリ700、ファイル600、git対象外。出力先のsymlinkとpath traversal、公開領域指定を拒否し、既存バッチを上書きしない。バッチにはgenerator/geometry/solver/curationのversion、上限、seed、両解、検証hashを残す。purposeはdesign_verification_only、curationはunreviewed。

## 結果

| 検証 | 結果 | 証跡 |
|---|---|---|
| 型・単体 | 型検査成功、24件成功（T20追加7件、保存追加1件を含む） | `../evidence/m2-unit.log` |
| 新規候補生成 | 88抽選、幾何学棄却83、採用5。63msの単一実行。性能保証や人間の難易度指標ではない | `../evidence/m2-generation.txt` |
| 新規5問 | TS一意性、Python exact-cover/独立DFSとも各1解。canonical SHA-256、構成解・検証解の完全被覆も一致 | `../evidence/m2-reference.json` |
| 同梱30問＋負例2問 | TSの解数・hashがPython2方式と一致。負例は原資料を改変せず、ソルバー検証用にID/purposeを変更した複製で照合 | `generator.test.ts` / `../evidence/m2-unit.log` |
| 例外・上限・CLI | 1解発見後の打切りも不採用。native CLI終了コード、再現性、seed境界、最大問数、候補不足、既存バッチ保持、非公開出力制限を確認 | 同上 |

新規バッチ: `content/private/candidates/m2-t20-20261012/batch.PRIVATE.json`。seedは再現用のローカル記録であり、公開distへ含めない。参照の `reference_generate.py` は同梱fixtureを書き換えるため実行していない。

同時にM1の保存所有権と短いスマートフォン画面を修正。29項目×3エンジン=87件の回帰を通し、ブラウザー確認した試遊生成物をこのPCからのHTTPS経路へ反映した。日英とインストール済みChromeで開始/ヒント/完遂/保存を再確認。詳細は `PLAYTEST_EVIDENCE.md`、`../evidence/e2e-m2.log`、`../evidence/m2-public-deployment.json`。

## 残るゲート

以下はT20完了時点の記録。後続のT21編集CLI・幾何学重複・試遊記録管理は `T21_EVIDENCE.md` に記録。実際の人間試遊・承認・ストック受入は引き続き未完了。

T20は機械検証CLIまで。T21の180日・盤面回転/鏡映・名称/色に依存しない幾何学重複、編集状態/承認CLI、難易度の編集は未実装。現状のバッチ内同一内容排除でG-08を満たしたとは扱わない。

新規5問と同梱30問を、人間による品質確認済みストックへ数えない。T22の実機試遊、離脱/ヒント/操作迷い、30問ストック、14/7問警告、M3の日次manifest/共有、正式M4受入は未完了。
