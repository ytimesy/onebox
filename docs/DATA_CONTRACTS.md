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
