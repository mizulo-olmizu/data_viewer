# DataViewer 設計図 — パフォーマンス

このドキュメントは、メモリ効率・データの取り回し/集計/表示速度に関する現状の課題と対応方針をまとめたもの。`overview.md`の「重視したいこと」（大規模データでの待ち時間削減）を実現するための各論にあたる。

## 前提

主なユースケースは、polarsで扱うような大規模データ（数百万行規模）。小規模データはCSVを直接見る/Google Sheetsで済ませることが多いため、このアプリの価値は「大規模データでもストレスなく取り回せること」に強く依存する。

DuckDBは列指向・ベクトル化・out-of-core処理を前提に大規模データ向けに作られたエンジンであり、本来はそれを活かして大規模データでも効率よく扱えるはず。しかし現状は、DuckDBで集計した後の受け渡し・フロント側の扱いで非効率が残っており、その強みを活かしきれていない箇所がある（2026-07-27の調査で洗い出し、詳細は下記）。

凡例: ✅ 対応済み / 🟡 部分対応 / ⬜ 未対応

## 実測結果(2026-07-27、`feature/perf-timing-logs`)

以下の課題は当初コードリーディングのみによる仮説だったため、`app_log`/`LogEntry`にduration計測を追加し(`handler.rs`の`extract_data`・`extract_table`・`execute_query`・`log_frontend_perf`)、実データで検証した。テストデータは`../data_viewer用テストデータ/`の`diamonds.csv`(53,940行・10列・6.7MB)と`flights.csv`(336,776行・19列・31MB)。

比較のため、同じ取り込み処理をDuckDB CLI(v1.3.2、アプリと同じ`duckdb`クレート系統)で直接実行したところ、`flights.csv`の`CREATE TABLE AS SELECT * FROM read_csv(...)`+`count(*)`は**0.33秒**で完了した。numeric_summarise/string_summarise相当の集計クエリ(stats/binning/value_counts)も個別に計測したが、いずれも数ms〜数十ms程度で、DuckDB自体の処理は全く問題にならないことを確認した。

アプリ内(`extract_data`)での実測値(`flights.csv`、19列):

| 区間 | 所要時間 | 備考 |
| --- | --- | --- |
| `extract_table`(Arrow→JSON→`Vec<Map<String,Value>>`変換、`db/src/lib.rs`の`into_json`込み) | **12,751ms** | `extract_data`全体(17,755ms)の72%を占める、最大のボトルネック |
| `df_json`最終文字列化(`serde_json::to_string(&df)`) | 3,308ms | 2番目に大きいコスト |
| 列ごとの`summarise`(19列合計) | 約1,600ms(1列あたり36〜143ms) | DuckDB側の集計自体は軽く、支配的ではない |
| `extract_data`合計 | 17,755ms | 上記の合計 |
| フロント側`invoke`往復(`extractTable`) | 23,313ms | バックエンド完了(17,755ms)との差、約5.5秒はIPC転送(104MBのJSON文字列)のオーバーヘッドと見られる |
| フロント側`JSON.parse` | 214ms | 想定に反し、ボトルネックではなかった |

`diamonds.csv`(10列、6.7MB)では`extract_table`が955ms、`df_json`が297ms、summarise合計が約300ms、`extract_data`合計1.58秒、フロント`invoke`往復3.68秒(IPCオーバーヘッドが約2.1秒)、`JSON.parse`は20ms。データ量が増えるほどArrow→JSON変換とIPC転送のコストが支配的になる傾向が見える。

**この実測から分かったこと:**
- 当初の仮説通り、「メインテーブル表示の全件ロード+JSON多段変換」(下記①)が実際に最大のボトルネックであることが定量的に裏付けられた。特に`extract_table`内のArrow→JSON変換が支配的で、DuckDBのクエリ実行自体や列summarise・SQL側の集計は速く、問題ではない。
- フロント側の`JSON.parse`は当初「メインスレッドをブロックする主要因」と疑っていたが、実測では数百ms以下と軽微だった。ボトルネックはバックエンド側の変換処理と、大きいJSON文字列をTauri IPCで転送するオーバーヘッドの方だった。想定を修正する。
- **副次的な発見(バグ)**: 計測を`extract_data`に組み込む際、`AppData`の`Mutex`を保持したまま`app_log`(内部で同じ`Mutex`を再度lockする)を呼んでしまい、自己デッドロックを一度作り込んだ。データサイズに関わらず`extract_table`/`execute_query`コマンド呼び出しが無限にハングする状態になっていた。修正は、計測結果を`Vec<(LogLevel, String, Duration)>`にバッファし、ロックを解放してからまとめてログ出力する形(`extract_data`が`PerfLog`を受け取り、呼び出し元コマンドが`flush_perf_log`で出力)。`AppData`のMutexを保持したスコープ内では`app_log`/`app_log_perf`を呼ばない、という制約は今後`handler.rs`を触る際にも注意が必要(既存コードは元々この規律を守っていたが、今回新規追加箇所でうっかり破ってしまった)。

## 現状の課題

### ⬜ メインテーブル表示: 全件ロード + JSON多段変換

- `extract_table`（`db/src/lib.rs:381-384`）にoffset/limit引数が無く、常に`SELECT * FROM {table_name}`で全件取得する。ページングの仕組みが存在しない。
- Arrowで取得した`RecordBatch`を`QueryResult::into_json`（`db/src/lib.rs:196-209`）で一度`arrow_json::WriterBuilder`によりJSON bytesへ変換し、それを`serde_json::from_reader`で`Vec<Map<String, Value>>`にパースし直している。
- さらに`handler.rs:315`の`extract_data`が`serde_json::to_string(&df)`で`df_json`として**もう一度文字列化**する。Tauri IPC自体もコマンド戻り値をJSONで送るため、実質「Arrow → JSON → 構造体 → JSON文字列 → IPC → JSON文字列 → JS構造体」という多段変換になっている。
- フロント側は`src/handler.ts:18,37`で`JSON.parse(result.dfJson)`と再度パースする。
- `src/Table.tsx`（`useReactTable`、443-462付近）は全件を`data`として保持し、`getSortedRowModel`/`getFilteredRowModel`でソート・フィルタも毎回クライアントJS側で全行処理する。`react-virtuoso`による仮想化はDOM描画の間引きのみで、データ取得自体は仮想化されていない。
- → 数百万行規模だと、起動時のロード・メモリ使用量・ソート/フィルタ操作のいずれもボトルネックになりうる。対応にはサーバー側ページング化（＋サーバー側ソート/フィルタへの切り替え）が必要で、「クライアント側で全行を即座にソート/フィルタできる」という現状のUXを変える設計判断を伴う。既存機能への影響が大きいため、着手時は別途設計を詰める。
- **IPC転送方式の見直し(要検討、2026-07-27追記)**: 実測で見つかった「バックエンド完了後さらに数秒かかるIPC転送オーバーヘッド」は、`df_json`(既にJSON文字列化済み)を`ExtractDataResult`の1フィールドとして返しているため、Tauriのコマンド戻り値シリアライズで**JSON文字列がもう一段JSONエスケープされ直している**ことが原因である可能性が高い。Tauriには標準のJSON化を経由しない手段がいくつかある。ページング設計と合わせて評価する候補:
  - `tauri::ipc::Response`: コマンド(`invoke`)の枠組みのまま、シリアライズ無しでArrayBufferとして返せる。単発の大きいバイナリ/テキストに向く。二重JSON化を避けられる可能性が高く、まず検証する価値がある。
  - `Channel`: 大量データを小分けにストリーミング送信できる。ページング/無限スクロールと組み合わせて、メモリ消費のスパイクと画面フリーズの両方を避ける設計に使えそう。
  - カスタムプロトコル(`<img>`/`<video>`/`fetch`から直接アクセス): 画像・メディア等バイナリ向けで、JSのメインスレッドを汚さない。今回のテーブルデータには直接使えないが、将来的にプロット画像等を扱う場合の選択肢として記録。
  - ローカルサーバー経由(WebSocket等でMessagePack/gRPCなど): Tauriの`invoke`の枠組み自体を超える。既にaxumのHTTPサーバーが常駐しているため技術的には流用できなくはないが、UI側の実装が大きく変わるため優先度は低い。
  - どれを採用するか(またはどれも採用しないか)は未検討。①の設計を詰める際にまとめて評価する。

### ⬜ numeric_summariseでのヒストグラム用生データ全送信

- `numeric_summarise`（`db/src/lib.rs:522-594`）は、統計量(min/max/quantile/mean/std)をSQL集計で計算し（これは適切）、`binning`（583行目）でヒストグラムのビンもSQL側で計算済みにもかかわらず、`extract_raw_column`（585行目）で列の生データも丸ごとRust側に取得している。
- `extract_raw_column`（506-520行目）は`SELECT {col} FROM {table}`で列の生データを全件取得し、`NumericSummary.raw`（`types.ts:90`）としてフロントへ送信される。
- **(訂正、2026-07-27実測時に判明)** 当初「ビンが既に計算済みなら生データは本来不要な無駄」と書いたが、実際には`raw`は死んでいるデータではなく、`SummaryDisplay.tsx`のヒストグラムを拡大表示するモーダル(`HistogramChartInteractive`、`src/charts/HistogramChart.tsx`の`binData`)で、ユーザーがビン数をインタラクティブに変更して再ビニングする機能に使われている。単純に送信をやめると、この「モーダルでビン数を変えて見る」機能が壊れる。
- 対応するには、(a)生データの送信を大規模テーブルでは打ち切る/サンプリングする(モーダルの再ビニング精度は落ちるがトレードオフとして許容する)、(b)インタラクティブな再ビニング自体をバックエンドへの再クエリ(`binning`にbin_size指定済みなのでSQLは既にある)に切り替える、のいずれかの設計判断が必要。実測(上記「実測結果」参照)では`extract_table`(全件取得+JSON変換)の方が支配的コストであり、生データ送信自体は`extract_raw_column`が列ごとに追加で1回SELECTを増やす程度の影響に留まるため、優先度は①より低い。

### ⬜ カラム集計・クエリ実行のたびの複数回フルスキャン

- `numeric_summarise`はカラムごとにstats/binning/raw(生データ)で3回、`string_summarise`/`boolean_summarise`（609-644, 646-672行目、`value_counts`(474-504行目)使用）は2回、独立したSQLを発行している。カラム数×複数回のフルスキャンになる。
- `execute_query`（`handler.rs:196-212`）はクエリ実行のたびに一時テーブル`_last`へ`CREATE OR REPLACE`し、`extract_data`で全件抽出＋全カラム再サマライズを行う。クエリ結果が大きいほど毎回のコストが増す。

### ⬜ DuckDB接続のメモリ/スレッド設定が未指定

- `DbState::try_new`（`db/src/lib.rs:213-220`）は`Connection::open`/`open_in_memory`のみで、`PRAGMA memory_limit`やスレッド数の設定を一切行っていない（リポジトリ内に該当するRustコードなし）。
- out-of-core処理を明示的に活かす設定がされておらず、大規模データで無制御なメモリ使用や意図しないOOM/スワップのリスクがある。

## 対応方針・優先順位

実測により、①(メインテーブルのページング化、特に`extract_table`のArrow→JSON変換とIPC転送)が支配的コストであることが定量的に裏付けられた。優先順位を実測ベースで更新する。

- **① メインテーブルのページング化・変換パイプラインの見直し(最優先)**: 実測で全体の8割以上を占めることが分かった。`extract_table`のArrow→JSON→構造体→JSON文字列という多段変換自体を減らす方向(例: Arrowから直接IPCで送れる形式にする、ページングでそもそも一度に変換する行数を減らす、など)で検討する。既存UX（即時クライアントサイドソート/フィルタ）を変える設計判断を伴うため、着手時に別途設計を詰める。仮想化ライブラリの統一(issue #8、`react-virtuoso`→`@tanstack/react-virtual`)もこの作業と合わせて設計するのが手戻りが少ない(下記`overview.md`のフェーズ4参照)。
- **④ DuckDB接続のメモリ/スレッド設定**は既存UXに影響しない低リスクな改善で、①と独立して先に着手できる。
- **② 生データ送信の削減**は、上記の訂正の通り機能(インタラクティブ再ビニング)とのトレードオフを伴うため、①ほど支配的ではない実測結果も踏まえ優先度を下げる。①の変換パイプライン見直しと合わせて検討するのが自然。
- **③ 複数回スキャンの削減**は実測で列summariseのコスト自体が小さいことが分かった(19列合計で全体の1割未満)ため、優先度は最も低い。ただし列数がさらに多いデータでは相対的に効いてくる可能性があるため、①対応後に再測定して要否を判断する。
- 着手タイミングは`overview.md`のロードマップを参照。要約表示の2次元可視化（フェーズ3）が加わると新たな集計クエリが増え、速度面の懸念が追加で出てくる可能性が高いため、2次元可視化の実装が一段落してからまとめて着手する方針とする（一度に検証する方が手戻りが少ない）。
