# T21: 幾何学重複と非公開編集CLI

2026-10-12 JST。このPCで実装・検証。実台帳は候補5問、試遊記録0、承認0、公開待ち0、正式日次公開履歴0。未経験者の試遊や180日の公開実績があるとは扱わない。

## 実装

- `packages/puzzle-tools/geometry.ts`: 盤面と全ピースを一緒に回転/鏡映する8通りの正規化キー。名前/色/初期向き/トレイ順に依存しない。ピース単体だけの鏡映を重複として統合しない。ゲームの反転禁止はそのまま。
- `curation.ts`: 最新180問の履歴検査と候補間重複、仮分類、連続警告、試遊の分母を残す集計、候補/試遊/編集承認/公開待ち/棄却/再レビュー。
- `private-store.ts`: private内に限定した台帳、単一writer、hash付きrevision、原子的state切替。symlink・破損・過去revisionがあるのにstateが欠けている場合は拒否。失敗した操作でstateを更新しない。
- `curation-cli.ts`: native Node CLI。取り込み・承認・公開待ち前にPython exact-cover/独立DFSも検査する。編集メモ、trial全文、seed、保存解は標準出力へ出さない。公開ファイルやサーバー設定は書き換えない。
- `verification/check_geometry.py`: TypeScriptに依存しない、座標変換を直接計算するPythonの幾何学hash照合。

## 操作

```sh
npm run curate -- import --batch <private-batch-name> --actor owner
npm run curate -- list
npm run curate -- inspect --id <candidate-id>
npm run curate -- start-trial --id <candidate-id> --actor owner
npm run curate -- record-trial --id <candidate-id> --actor owner --report <human-report.json>
npm run curate -- approve --id <candidate-id> --review <editor-review.json>
npm run curate -- queue --id <candidate-id> --actor owner
```

編集台帳は `content/private/curation/main/state.PRIVATE.json`。`--workspace <safe-name>` で別の非公開台帳を選べる。テスト用workspaceは実台帳と分離し、終了後に削除する。現台帳は `m2-t20-20261012` の既存5問を取り込み済みなので、同じバッチの再取り込みはID重複として拒否する。

human-reportに必要なキー: `kind`（human_report）、`trial_id`（個人名でないラベル）、`device`（phone/desktop）、`input`（touch/drag/keyboard）、`locale`（ja/en）、`attempt_mode`（first/practice）、`outcome`（completed/unfinished）、実測 `active_elapsed_ms`、`hint_count`、`interrupted`、`first_piece_placed`、`confusion`（none/anchor/rotation/drag/other）。値は実際の試遊から入力する。CLIは手動の申告を保存するもので、本人や実機を認証したとは扱わない。初期配置だけの回答を完遂報告へ変換しない。初回の開始/完了/完了中央値と練習を含む全体を区別し、初回の難易度へ練習の時間を混ぜない。

editor-reviewに必要なキー: `reviewer`（ラベル）、`notes`（判断メモ）、`accepted_warnings`（inspectが出した警告全件）、`check_hash`（inspectの現在の値）。スマートフォンの完遂報告が1件もなければ承認不可。承認後に履歴・別候補・試遊記録が変わると公開待ち前に再レビューが必要。`reopen --id ... --actor ...` で過去記録を保持して試遊状態へ戻す。`reject --id ... --actor ... --notes ...` は棄却を記録する。重複自体は編集メモで免除できない。

公開履歴の入力は `import-history --file <history.json> --actor owner`。形式はformat_version=1、total_released、items。itemsは最新180件（180未満は全件）を公開順に含み、各項目にsequence、published_at（UTC ISO）、puzzle（production_daily）、hash、solver_nodesを記録する。途切れた連番・古い履歴の変更・hash/一意性/ノード数不整合は拒否。TS検査10秒、Python検査10秒の別々の上限があり、不明/打切りでも更新しない。M3の実配信履歴との自動接続はまだない。

queuedは非公開の公開待ち。purposeはdesign_verification_onlyのままであり、T22のストック受入やM3配信へ自動昇格させない。

## 検証結果

| 検証 | 結果・証跡 |
|---|---|
| 型・単体 | `npm run typecheck` / `npm test`。34件成功、T21追加10件。`../evidence/t21-unit.log` |
| 全体変換・装飾差 | 8変換×同梱30問に名称/初期向き/模様/順序変更を加えて同じキー。単体鏡映や盤面だけの鏡映で異なるものは統合しない |
| 独立Python | 同梱30問＋8変換の38入力でTS/Python幾何学hash一致。数学・機械検証であり人間評価ではない |
| 180問境界 | 合成の181公開扱いで最新180件（sequence2〜181）を検査。最初の1件の重複を検出。179件しかない入力を拒否、過去内容変更/後退も拒否。実公開履歴ではない |
| 試遊・承認 | 合成の未完了を分母に残す、報告なしの承認/公開待ち拒否、スマートフォン完遂＋現在の編集レビューでのみ遷移。警告未確認・承認後の履歴更新を拒否。テスト結果を実台帳の人間報告として数えない |
| 保存・CLI | 実NodeでJSON/CLIを実行。非公開出力、600ファイル、writer競合、例外時state保持、hash改変/state欠損、symlink/公開パス拒否 |
| 実台帳取り込み | TS/Python再照合後、5候補取り込み、候補内幾何学重複0。5問ともcandidate、試遊/承認/公開待ち0。`../evidence/t21-import.txt` / `../evidence/t21-catalog.txt` |
| 実候補の独立幾何学検査 | 実台帳5問の幾何学キーをPythonでも照合し一致。仮分類medium4/low1は人間難易度ではない。`../evidence/t21-review-summary.json` |
| 公開境界・既存試遊 | `npm run build:playtest`で型/build/allowlist/PRIVATE検査成功。83,970 gzip bytes、digestは配信中の4556a6d127830db71d365fec78a42442c8cbf82e68ae5f9bdf6145fe5497264cと同一。公開HTTPSの日英開始/ヒント/完遂/保存を再確認。`../evidence/t21-build.txt` / `../evidence/public-smoke.txt` |

ノードのlow(<25)/medium(25〜99)/high(100以上)は仮分類。直前2問と形セット・角/外周の固定分布・仮分類が3回続く時に編集警告を出す。完了者中央値だけでなく開始数・未完了・ヒント・中断・操作迷いを併記し、人間の難易度や45〜90秒目標へ自動変換しない。

## 残るゲート

T21は編集ツールと機械検証まで。M1の実機一問完遂・端末別・支援技術、T22の候補を安全に試す導線・人間の品質確認・30問以上のストックは未完了。ユーザー確認済みの「スマートフォンで最初の1ピースを置けた」はM1固定試遊の初期操作であり、この5候補の完遂として登録していない。

G-08は編集CLIまでの部分証跡。M3の日次公開へ最新の実公開履歴を必ず接続し、出力直前の検査を省略できないようにする必要がある。manifest/JSON/hash・当日/過去固定URL・共有・正式M4受入も残る。

既存試遊URL: https://onebox.formflow-ops.com/ja/ 。今回の編集ツールはこのPC内で使う非公開CLI。候補問題や解答を公開UIへ追加していない。

公開版の生成物は同一なので再promotionは不要。配信元・共用Cloudflare設定・他アプリのプロセスを変更していない。公開経路の既知のGoogleタグ挿入は引き続きCSPで遮断し、完全非挿入を達成したとは扱わない（`PLAYTEST_EVIDENCE.md`）。
