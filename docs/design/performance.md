# DataViewer 設計図 — パフォーマンス

このドキュメントは、メモリ効率・データの取り回し/集計/表示速度に関する現状の課題と対応方針をまとめたもの。`overview.md`の「重視したいこと」（大規模データでの待ち時間削減）を実現するための各論にあたる。

## 前提

主なユースケースは、polarsで扱うような大規模データ（数百万行規模）。小規模データはCSVを直接見る/Google Sheetsで済ませることが多いため、このアプリの価値は「大規模データでもストレスなく取り回せること」に強く依存する。

DuckDBは列指向・ベクトル化・out-of-core処理を前提に大規模データ向けに作られたエンジンであり、本来はそれを活かして大規模データでも効率よく扱えるはず。しかし現状は、DuckDBで集計した後の受け渡し・フロント側の扱いで非効率が残っており、その強みを活かしきれていない箇所がある（2026-07-27の調査で洗い出し、詳細は下記）。

凡例: ✅ 対応済み / 🟡 部分対応 / ⬜ 未対応

## 現状の課題

### ⬜ メインテーブル表示: 全件ロード + JSON多段変換

- `extract_table`（`db/src/lib.rs:381-384`）にoffset/limit引数が無く、常に`SELECT * FROM {table_name}`で全件取得する。ページングの仕組みが存在しない。
- Arrowで取得した`RecordBatch`を`QueryResult::into_json`（`db/src/lib.rs:196-209`）で一度`arrow_json::WriterBuilder`によりJSON bytesへ変換し、それを`serde_json::from_reader`で`Vec<Map<String, Value>>`にパースし直している。
- さらに`handler.rs:315`の`extract_data`が`serde_json::to_string(&df)`で`df_json`として**もう一度文字列化**する。Tauri IPC自体もコマンド戻り値をJSONで送るため、実質「Arrow → JSON → 構造体 → JSON文字列 → IPC → JSON文字列 → JS構造体」という多段変換になっている。
- フロント側は`src/handler.ts:18,37`で`JSON.parse(result.dfJson)`と再度パースする。
- `src/Table.tsx`（`useReactTable`、443-462付近）は全件を`data`として保持し、`getSortedRowModel`/`getFilteredRowModel`でソート・フィルタも毎回クライアントJS側で全行処理する。`react-virtuoso`による仮想化はDOM描画の間引きのみで、データ取得自体は仮想化されていない。
- → 数百万行規模だと、起動時のロード・メモリ使用量・ソート/フィルタ操作のいずれもボトルネックになりうる。対応にはサーバー側ページング化（＋サーバー側ソート/フィルタへの切り替え）が必要で、「クライアント側で全行を即座にソート/フィルタできる」という現状のUXを変える設計判断を伴う。既存機能への影響が大きいため、着手時は別途設計を詰める。

### ⬜ numeric_summariseでのヒストグラム用生データ全送信

- `numeric_summarise`（`db/src/lib.rs:522-594`）は、統計量(min/max/quantile/mean/std)をSQL集計で計算し（これは適切）、`binning`（583行目）でヒストグラムのビンもSQL側で計算済みにもかかわらず、`extract_raw_column`（585行目）で列の生データも丸ごとRust側に取得している。
- `extract_raw_column`（506-520行目）は`SELECT {col} FROM {table}`で列の生データを全件取得し、`NumericSummary.raw`（`types.ts:90`）としてフロントへ送信、`SummaryDisplay.tsx:224`でヒストグラム描画に使われている。
- ビンが既に計算済みであれば生データは本来不要なはずで、これは既存UXを変えずに削減できる無駄。

### ⬜ カラム集計・クエリ実行のたびの複数回フルスキャン

- `numeric_summarise`はカラムごとにstats/binning/raw(生データ)で3回、`string_summarise`/`boolean_summarise`（609-644, 646-672行目、`value_counts`(474-504行目)使用）は2回、独立したSQLを発行している。カラム数×複数回のフルスキャンになる。
- `execute_query`（`handler.rs:196-212`）はクエリ実行のたびに一時テーブル`_last`へ`CREATE OR REPLACE`し、`extract_data`で全件抽出＋全カラム再サマライズを行う。クエリ結果が大きいほど毎回のコストが増す。

### ⬜ DuckDB接続のメモリ/スレッド設定が未指定

- `DbState::try_new`（`db/src/lib.rs:213-220`）は`Connection::open`/`open_in_memory`のみで、`PRAGMA memory_limit`やスレッド数の設定を一切行っていない（リポジトリ内に該当するRustコードなし）。
- out-of-core処理を明示的に活かす設定がされておらず、大規模データで無制御なメモリ使用や意図しないOOM/スワップのリスクがある。

## 対応方針・優先順位

- ①（メインテーブルのページング化）が最もインパクトが大きいが、既存UX（即時クライアントサイドソート/フィルタ）を変える設計判断を伴うため、着手時に別途設計を詰める。
- ②（生データ送信の削減）・④（メモリ/スレッド設定）は既存UXに影響しない低リスクな改善で、着手しやすい。
- ③（複数回スキャンの削減）は集計クエリの合成（1カラムにつき複数SQLを1つにまとめる、など）が必要でやや設計コストがある。
- 着手タイミングは`overview.md`のロードマップを参照。要約表示の2次元可視化（フェーズ3）が加わると新たな集計クエリが増え、速度面の懸念が追加で出てくる可能性が高いため、2次元可視化の実装が一段落してからまとめて着手する方針とする（一度に検証する方が手戻りが少ない）。
