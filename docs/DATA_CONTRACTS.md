# データ契約
## 公開問題
`examples/sample_puzzle.json` は構造例。productionではpurposeを正式用途に設定し、公開済みID/slugの対応をmanifestに持つ。
公開JSONの最小フィールド:
```ts
interface PuzzlePayload {
  schema_version: 1;
  rules_version: 'onebox-v1';
  puzzle_id: string;
  purpose: 'production_daily' | 'practice' | 'design_verification_only';
  board: { width: 5; height: 5; blocked: [number,number][] };
  pieces: Array<{
    id: 'A'|'B'|'C'|'D'; cells: [number,number][];
    initial_rotation: 0|1|2|3; pattern_id: string;
  }>;
  rules: { allow_reflection: false; target_seconds: 60; allow_overtime: true };
}
```
公開時purposeはproduction_daily/practiceだけ許可。negative用JSONは列挙値不正としても拒否する。
この定義だけでは長さや連結性を保証しない。別途ランタイムバリデーションを必須とする。
座標は整数で有限、IDはallowlist、配列長固定、余分な未知フィールドは公開ビルドで拒否する。

## 公開manifest
```ts
interface ReleaseManifest {
  manifest_version: 1;
  published_at: string;           // UTC ISO8601
  release_status: 'ready'|'delayed';
  active: {
    puzzle_id: string;
    edition_utc: string;         // YYYY-MM-DD
    slug: string;
    payload_url: string;         // same-origin /puzzles/<hash>.json
    sha256: string;
    opens_at: string;
    scheduled_close_at: string;  // 次回予定、ゲーム強制終了ではない
  };
  next_update_at: string;
  recent: Array<{puzzle_id:string;edition_utc:string;slug:string}>;
  recalled_ids: string[];
}
```
今日のIDはactiveを正とする。未来の予約問題をrecentやJS配列に列挙しない。
時刻はUTC保存・現地表示。未来の予約配信を勝手に行わない。遅延時には最後に公開した版の日付を明記する。

## ハッシュ
公開ビルドは、キーを再帰的辞書順に整列、配列順保持、余分な空白なし、UTF-8のJSONに対してSHA-256を計算する。
文字列は規定のASCII ID/enum中心にし、浮動小数はpayloadに入れない。JS/Pythonでcanonical出力をfixture照合する。
JSONとmanifestのsha256が一致しなければその問題を開始しない。
ハッシュは破損検出とバージョン固定のためで、所有者の電子署名や不正防止証明ではない。

## 端末内の記録
```ts
interface LocalAttempt {
  record_version: 1;
  run_id: string;
  puzzle_id: string;
  puzzle_hash: string;
  rules_version: string;
  mode: 'first'|'practice'|'tutorial';
  state: 'playing'|'paused'|'completed'|'revealed'|'abandoned';
  placements: Array<{piece_id:string;rotation:0|1|2|3;x:number;y:number}>;
  active_elapsed_ms: number;
  interrupted: boolean;
  clock_status: 'continuous'|'resumed'|'uncertain';
  hint_count: number;
  timer_visible: boolean;
  started_at_client: string;
  finished_at_client: string|null;
}
```
端末時刻は参考値であってサーバー認定時刻ではない。初回attemptは論理的に上書き不可とし、再試行は別run。
最大180問ぶんを保持し、古い途中状態を先に整理する。消去、プライベートブラウジング、保存拒否で失われ得る。[S7]
localStorage読書きは例外捕捉し、保存不能時にもプレイを止めない。

## 共有URL
問題固定URLへ `?src=share` を付ける。個人IDや解答、run_id、名前は入れない。
紹介者別の追跡や友達ランキングは初版に含めない。国・氏名・写真を要求しない。
OGは問題の紹介画像のみ。クエリのタイムをサーバー認定スコアのように表示しない。

## 集計イベント（任意機能）
```ts
interface EventBatch {
  schema_version: 1;
  events: Array<{
    event_id:string; anonymous_id:string; session_id:string;
    type:'puzzle_start'|'puzzle_complete'|'puzzle_reveal'|
         'share_intent'|'share_handoff'|'link_copy_success';
    puzzle_id:string; run_id:string; mode:'first'|'practice'|'tutorial';
    locale:'ja'|'en'; source:'share'|'direct'|'promo';
    elapsed_ms?:number; hints?:number; interrupted?:boolean;
  }>;
}
```
同意済みの場合のみ送信。1batch最大4KB、最大8event。重複event_idは一意制約で除去。
自由テキスト、解答配置、メールアドレス、位置情報、動画、画像を送らない。
各操作を送らず開始/結果/共有時だけ。modeがfirstの値のみ初回ファネルに使用する。

`POST /collect/events`: 正常/重複受理204、形式不正400、サイズ超過413、制限429、停止503。
非2xxでもゲームは継続。再送は指数バックオフ最大3回、最大24時間、同意撤回で破棄。
同意前に遡ったイベント収集・送信はしない。共有流入はそのセッションだけのsourceとして扱う。

## 2026-10-14: 実装する公開契約

`packages/game-core/release.ts` が厳密な実装定義。manifest_version1にstage（playtest/daily）、active/recentのpurpose、payload/hash/固定slug/UTC時刻を追加。playtestは既知の固定practice1問だけでedition/opens/close/next_updateはnull。dailyはonebox-YYYY-MM-DD、当日UTC00:00と翌日UTC00:00、recentの降順、公開時より未来の版を含めない、activeを撤回できない条件を検査する。版の遅延と未確定時刻を混同しない。

公開済み固定版は `/release.json`（no-cache）と `/puzzles/<hash>.json`（immutable）を配信し、問題はcanonical bytes/10KB上限・purpose/ID/rules/hashを照合する。private prepareは台帳の有効品質在庫30問を要求するが、PRIVATE計画だけを書き、公開切替/台帳更新は行わない。正式日次のcommitと撤回/履歴接続は未実装。

ローカル消去には非個人のonebox:v1:clear-generationを使う。これは削除通知の印で、参加者識別/分析IDではない。消去後に古いタブがrunを復活させないため、記録自体は消し、印だけを保持する。

## 2026-10-17 互換追加と排他

LocalAttempt v1に `undo_history?: Placement[][]` を追加。各配列は同一問題の合法配置（0〜4ID）、最大512スナップショット。欠落は旧形式として有効、初回/ヒント/中断/結果は維持。v1からの破壊的移行やrules_version変更は行わない。破損currentはUUID付き隔離キーへ保存できた時だけ元キーを除去し、保存失敗なら元の永続データを残す。

`onebox:v1:preferences` はtimer_visible/reduce_motionの表示設定。終端runは書き換えず最新の表示設定だけ適用する。180問より古い詳細の通常整理でも `first:<puzzle_id>:<rules_version>` の軽量識別は残す。識別はブラウザー消去/明示削除まで保持し、quota超過時は保存保証せず練習へ退避する。

Web Locksは問題単位の所有権と `onebox-storage-v1` の短期更新ロックを使用。非対応時の専用IndexedDB `onebox-ownership-v1` / leasesにはowner/token/期限だけを保持し、同じreadwrite transaction内で所有者照合とlocalStorage更新を行う。引継ぎでtokenを更新し旧世代を拒否。期限は4秒、heartbeatは1秒。問題・結果・個人プロフィールをIndexedDBへ移設しない。DBとlocalStorageの複数書込み全体をクラッシュ時に原子的commitできるという保証はなく、復帰時検査/隔離と500msチェックポイントを継続する。

日次previewの取得済みデータはsessionStorageのonebox:v1:public-cacheへmanifestと取得済みpayloadを保持する。再利用時もmanifest/ID/purpose/hashを再検証し、通信失敗による新規開始は練習。壊れたmanifestやhash不一致を黙ってキャッシュへ差し替えない。payloadは10KB、manifestは1MBまでのストリーム読込上限を設ける。

2026-10-17継続: public-cacheは `{manifest,puzzles:{[sha256]:payload}}` へ互換追加。従来の単一 `{manifest,puzzle}` もIDから該当entryを照合して読める。新manifestのrecent/非撤回entryだけを保持し、全体1,100,000文字を上限とする。これは公開データだけの任意キャッシュで、run保存形式を変更しない。新manifestとpayloadの通信失敗（network/timeout/5xx）に限り再検証した取得済み版を使える。HTTP 4xx・不正JSON/hashは自動代替しない。

日次履歴は同manifestが許可する非撤回entryに対してのみ、端末内runを検査する。問題の取得失敗と記録破損を分け、未確認の問題は警告付きで省くが保存原本/初回識別は変更しない。最大7件の結果がそろうまで新しいrun順に検査し、同一payloadの取得は1回の閲覧で共用する。読込中の全消去・個別削除を結果へ反映する。

## 2026-10-17: PRIVATE日次計画 v1 と非公開snapshot

DailyPlanはplan_version1、manifest、payload_json、source_id、source_revision、source_catalog_hash、previous_manifest_hash、check_hash、solver_nodesを持つ。保存計画を認可情報とは扱わず、現在の台帳と前回manifestから全体を再計算してcanonical digestを比較する。新規計画はUTC当日だけ有効。公開履歴がある場合は前回manifestと保存履歴のID/hash/版を照合する。

非公開snapshotはformat_version1/local_only:true/catalog/manifest/payloads/plans/sources/parentを持つ。snapshot本体はPRIVATE、PUBLICデータ面は厳密にrelease.jsonとpuzzles/<sha256>.jsonだけ。digest名の不変ディレクトリを作り、内容を読み戻して検査した後にcurrentを原子的に切り替える。履歴はコピー台帳の中にあり、実台帳と別である。計画digestと公開ID/sourceの対応で再実行を1回に保つ。予定版、初回/保存runをこのsnapshotへ移設しない。

プロセス中断後のwriter.lockと不完全/未採用snapshotは調査用に残す。自動ロック解除や不正snapshotの上書きは行わない。物理停電時の耐久性を保証したとは扱わない。

## 2026-10-17: 全問撤回と非公開運用記録

manifest_version1の日次release_statusにunavailableを追加する。全recentがrecalled_idsに入り、activeも撤回済みである場合だけ有効。active/recentは非プレイ用の識別情報で、トップの選択結果はunavailable、撤回済み固定URLはrecalledになる。ready/delayedはactiveの撤回を拒否し、playtestはready以外を拒否する。next_update_atはUTC翌日境界を維持するが、利用停止画面では新問公開の約束として表示しない。

非公開snapshotに任意のcontrols配列を追加する。従来のcontrolsなしsnapshotも元のdigestで検証できる。各要素はaction（recall/delayed/refresh_catalog）、puzzle_id（recall時の公開ID、他はnull）、at、actor、reason。最大2000件、reasonは空白のみ不可/280文字以内。候補・試遊・公開履歴は別途保持し、撤回時は提供対象payloadだけを除く。再実行は既に適用済みなら履歴を増やさない。実変更は単一writer/expected head/非逆行時刻/検査後UTC日付一致を要求する。

refresh_catalogは同じ公開履歴、増加するrevision、既存候補のID/問題とイベント/試遊のprefix保持を要求する。承認や人間報告を生成する機能ではない。実台帳・端末内run保存v1・初回識別の形式は変更しない。

## 2026-10-17: 日次の開始前確認

日次の画面内状態へ任意のupdatedを追加する。新しいトップのactiveが読込済みentryと異なる場合だけtrueとし、entry/puzzle/保存runを新問へ差し替えない。新規開始前の確認結果から練習へ退避し、既存fallbackの練習理由も維持する。これは画面内の状態で、公開manifestや保存run v1のフィールドを追加しない。

確認はrelease.jsonをno-cacheで取得し、1MBの上限、10秒の期限、日次stage、保存済みentryの全メタデータの一致を検査する。manifestの時刻逆行や確認済みrecalled_idsの欠落は新規開始を止める。取得済みキャッシュが利用できる場合はページ読込時もrecalled_idsの欠落を拒否し、古いmanifestで撤回情報を上書きしない。未知の新しい撤回を通信不能時に知ることは保証しない。

確認中はrunと初回識別を作らず、保存用の短いmutationロックを通信待ちへ持ち越さない。記録消去/所有権喪失/画面終了で要求を中断し、返答が遅れても古い世代の開始を拒否する。再開はこの新規開始確認を通さず、元runのID/hashと結果の不変性を維持する。

## 2026-10-17: 公開アーカイブとsnapshotの互換追加

日次manifest_version1に任意の`archive:{url,sha256,count}`を追加する。URLは正確に`/archives/<sha256>.json`、countは1〜10,000。playtestでは許可しない。本文は`{archive_version:1,entries:PublishedProblem[]}`で、IDの重複なし/UTC版降順/未来なし/厳密な既存PublishedProblemフィールドを要求する。recentの全entryとrecalled_idsの全IDを含み、件数とcanonical SHA-256を照合する。unavailableでは索引全件が撤回済みでなければならない。

PRIVATE snapshot v1には任意のarchive_version:1だけを追加する。元のplans/sourcesから全公開IDを列挙し、元sourceから再構成した公開Puzzle/hashを照合する。PUBLICデータ面はrelease.json、archives/<sha256>.json、未撤回のpuzzles/<sha256>.jsonに限定する。索引に撤回メタデータを残しても、payloadの提供は拒否する。旧snapshotは元のdigest/ファイル構成で読め、新しい変更は旧版を保持した別snapshotへ切り替える。

DailyPlan v1のmanifestに新索引のhash/countを含める。前回の索引がPRIVATEの180件履歴より大きい場合、準備/再検証に完全な前回索引を必須とし、元の公開件数とhashも照合する。CLIのprevious-nameは検証済みsnapshotのmanifestと索引を読む。旧PRIVATE計画を上書きせず、必要なら別名で再準備する。

任意sessionStorageキャッシュにarchiveを追加する。従来のmanifest/puzzlesと旧単一puzzle形式は読める。アーカイブ由来の問題を再利用する場合は索引hashを再検査し、recent外でも同じ公開ID/hashに限定する。最新の撤回指定を優先し、上限1,100,000文字を越えたキャッシュは保持を保証しない。索引HTTP応答は4MB、問題JSONは従来の10KB、取得処理は10秒で制限する。キャッシュ拒否/容量不足をプレイ不能やrun削除へつなげない。
