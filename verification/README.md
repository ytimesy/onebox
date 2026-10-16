# 参照実装の検証範囲
完成アプリではなく、提案ルールの数学的成立性を確認するためのPythonコード。

`reference_solver.py`: 24列のexact-cover探索。解数は2で打切り、予算超過は未検証扱い。
`reference_generate.py`: seed固定の設計用候補生成。30問の例を再作成する。公開向けの編集・幾何学重複判定は未実装。
`test_reference.py`: 独立した固定ピース順DFSと照合する8テスト。
`generation_report.json`: 候補生成の実行記録。
`test_report.txt`: 実行したテスト結果。

実行場所はアシスタントの作業コンテナであり、ユーザーのMac miniではない。
公開配信・実機ブラウザー・UIの操作感・アクセス負荷・商用利用条件・人間の難易度は検証していない。

注意: reference_generate.pyはsample/batchを書き換える開発ツール。負例fixtureの再生成ツールではない。
生成器改修後は負例も含めすべてのテストを再実行すること。
