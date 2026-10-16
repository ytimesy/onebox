# T22 在庫監視・試遊集計の証跡

2026-10-13（JST）。T22は作業中。在庫監視の実装は完了、人間の品質受入と30問ストックは未完了。

## 利用

このPCで http://localhost:4324/ の「在庫と試遊集計」を開く。CLI更新後は「在庫を再確認」。試遊の下書き/JSON書き出しだけでは台帳の集計へ追加されない。取り込み手順と専用サービスの停止/復旧は [T22_EVIDENCE.md](T22_EVIDENCE.md)。

```sh
npm run curate -- stock
npm run check:reviewer
node scripts/check-stock-live.ts
```

`stock` は読み取り専用。候補/試遊中/承認済み/公開待ち登録/棄却と、検査が有効な公開待ちを分ける。queuedの現在の編集検査hash・重複・TS一意性再探索を確認する。0〜6問は要対応、7〜13問は警告、14問以上は警告なし。目標30問と不足は別に示す。除外理由は重複、古い編集検査、機械検証未確認/失敗の優先順で排他的。探索上限は1問10万ノード/最大1.5秒、全体3秒。未確認を成功へ数えない。

現行のT21検査は他候補の状態変化もhashへ含む。台帳の編集後、既存queuedが再レビュー対象になり得る。一括編集/配信順の固定はM3接続時に別途設計する。readyが30になったとしても、人間の難易度・偏り・操作品質のT22受入を自動完了にしない。

## 実台帳の確認

- revision 1。候補5、試遊中0、承認0、公開待ち登録0、棄却0。
- 有効な公開待ち0、目標30、不足30。画面は「要対応：公開待ちが7問未満」。除外0。
- 手動試遊報告0。全体/初回/練習/スマートフォン初回すべて開始0、率/中央値null、画面は「未計測」。
- 棄却候補の報告も分母へ残し、初回と練習を分ける。中央値は完了者のみ、ヒント/中断ありを含む。45〜90秒は初回中央値の仮目標で、承認判定ではない。
- 未取り込みの開始/未完了は集計に含まれない。全訪問者の離脱率ではない。ブラウザーに残る下書きも適宜人間が確認して取り込む必要がある。
- 実台帳はブラウザー試験と稼働検証の前後でhash不変。実候補を生成・昇格・公開していない。

集計は [../evidence/t22-stock-summary.json](../evidence/t22-stock-summary.json)、稼働確認は [../evidence/t22-stock-live.json](../evidence/t22-stock-live.json)。JSON時刻はUTC、画面はPCの現地時刻。

## 検証

| コマンド/確認 | 結果・範囲 |
| --- | --- |
| `npm run typecheck`（ビルドでも実行） | 成功 |
| `npm test` | 44件成功。追加5件で6/7/13/14/30の警告境界、古い編集検査/重複の除外、台帳不変、不正入力の拒否、初回/練習/phoneの分離、棄却報告保持、0件null、CLI安全出力を確認 |
| `npm run test:reviewer-server` | 1件成功。新しい集計APIのno-store/no-CORS、GET/HEAD、異Origin/POST拒否、安全な返却フィールド、破損時503も確認。従来のHost/cross-site/私有ファイル境界を維持 |
| `npm run build:reviewer` | 型検査と出力allowlist成功。var/reviewer限定、JS+CSS+Worker gzip88,301 bytes |
| `npm run check:reviewer` | Chromium/Firefox/WebKitの試遊5フローずつ（15フロー）と新しい在庫0/未計測表示、320/390/768/1440px成功。合成報告のCLI取り込み後に再確認で50%へ更新、503で古い値を隠す、復旧で再表示を確認 |
| `node scripts/check-stock-live.ts` | 稼働中localhostの集計と実台帳一致。Chromiumで4幅・横はみ出しなし・ページエラー0・ローカル要求のみ。候補を選択せず台帳不変 |
| 公開HTTPSの読み取り検査 | `/health`・日英トップ200。在庫/候補API・専用画面・新しいprivate JS/CSSは404 |

ブラウザー結果は [../evidence/t22-reviewer-browser.txt](../evidence/t22-reviewer-browser.txt)。合成の確認チェックやhuman_reportは使い捨て台帳だけに保持し、実際の人間試遊とは扱わない。画面証跡は `content/private/reviewer-evidence/` のみ。稼働画面の390pxも目視して、数値・未計測表示・折り返しを確認した。

変更箇所: `packages/puzzle-tools/inventory.ts` と単体試験、curation CLIのstockコマンド、reviewerサーバーの集計API、`apps/reviewer/src/InventoryPanel.tsx`/CSS/画面組み込み、非公開サーバーとブラウザーの検証、稼働確認スクリプト、仕様/進捗文書。

## 配信と残る確認

専用 `local.onebox.reviewer` だけを再起動し、127.0.0.1:4324で稼働確認。既存public web/tunnelはPID15396/14063を維持。共用Cloudflare configのSHA-256は `e6cb34a9d433d83a6c842e357ca838ad67eeb196906e06047cfa39009866c958` のまま。公開releaseは `m1-fe2cd38642c2` を維持し、新しいreviewer assetsをpublicへコピーしていない。

公開ゲームのソース・releaseを変更していないので、今回M1の87件E2Eや公開ゲーム完遂は再実行していない。前回の証跡と、今回のHTTP/配信境界の確認を区別する。共用zoneの既知Google gateway/CSP遮断の完全な非挿入受入も継続して未達。

残作業は安全なスマートフォン候補試遊のHTTPSアクセス制御、人間による難易度・操作迷い・ヒント・未完了の評価、30問以上の品質確認済みストック、M1の実物端末での一問完遂/端末別/支援技術、M3日次公開との接続。PC物理再起動の検証も今回はしていない。
