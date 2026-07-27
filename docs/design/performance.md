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

## 対応①実施後の再計測結果(2026-07-27、変換パイプライン高速化+`tauri::ipc::Response`導入後)

上記の実測を踏まえ、以下を実施した(詳細は下記「① メインテーブル表示」節を参照):
- `QueryResult::into_json`(Arrow→JSON bytes→`Vec<Map<String,Value>>`→呼び出し元で再度`serde_json::to_string`)を、Arrow→JSON bytesの結果をそのまま文字列として返す`into_json_string`に置き換え、二重変換を解消。
- `extract_table`/`execute_query`コマンドの戻り値を、通常の`Result<T, InvokeError>`(Tauriが`serde_json::to_string`で再シリアライズする)から`tauri::ipc::Response`(手組みのJSON文字列をそのままレスポンスbodyにする、Tauri側の再エスケープなし)に変更。フロントも`response.json()`で最初からパース済みオブジェクトを受け取れるため、`JSON.parse(result.dfJson)`の手動呼び出しが不要になった。

`flights.csv`(336,776行・19列)でのBefore/After比較:

| 区間 | Before | After | 倍率 |
| --- | --- | --- | --- |
| `extract_table`(Arrow→JSON、旧「df_json stringify」込み) | 12,751ms + 3,308ms = 16,059ms | **3,424ms** | 約4.7倍 |
| 列ごとの`summarise`(19列合計) | 約1,600ms | 約1,600ms(変更なし、想定通り) | - |
| `extract_data`合計 | 17,755ms | **5,137ms** | 約3.5倍 |
| フロント側`invoke`往復(`extractTable`) | 23,313ms | **6,933ms** | 約3.4倍 |
| IPC転送オーバーヘッド(invoke往復 - バックエンド完了の差) | 約5,500ms | 約1,800ms | 約3倍改善 |

`diamonds.csv`(53,940行・10列)では`extract_data`合計が1,580ms→**653ms**(約2.4倍)。既存UX(クライアント側ソート/フィルタ・セル範囲選択・CSVエクスポート等)は無変更で、フロントの機能・見た目に影響を与えずにこの改善を達成した。

なお、IPCオーバーヘッドは3倍改善したものの完全にゼロにはならなかった(約1.8秒残っている)。これは104MBのJSONテキスト自体をIPC経由で転送・`response.json()`でネイティブパースする実コストであり、二重エスケープ分は解消できたが「巨大なJSONペイロードそのものを一度に送る」という構造は変えていないため。メインテーブルのページング化(本節下記、対応未着手)まで実施すれば、この残りのコストも根本的に下がる見込み。

## フロント側レンダリングの実測(2026-07-27追記)

上記まではバックエンド+IPCの計測に留まっていたが、`App.tsx`の`update-data`イベントハンドラに`setTableData`後の再描画完了(二重`requestAnimationFrame`で計測)を追加したところ、`flights.csv`(33万行)で**約2,987ms**かかっていることが判明した。これは今まで見えていなかったコストで、`invoke`往復(6,998ms)とは別に上乗せされる。

体感の合計時間は 6,998ms(invoke) + 2,987ms(レンダリング) ≈ **約10秒**。この行数依存のコストは、ページング化すれば(1ページ数百行の処理で済むため)ほぼ解消される見込みで、ページング化の効果を見積もる際はバックエンド/IPC分に加えてこのレンダリング分も含めて評価する必要がある。

### レンダリング内訳(一時計測、`Table.tsx`の`filteredData`/`getRowModel`呼び出しと`<Profiler>`でさらに切り分け)

- 高度フィルタ適用(`applyAdvancedFilter`、`useMemo`): **0ms**(アクティブな条件が無い場合は早期リターンするため無視できる)。
- `table.getRowModel()`(`getCoreRowModel`/`getSortedRowModel`/`getFilteredRowModel`の実計算、初回呼び出しのみ): `diamonds.csv`(53,940行)では**0ms**(誤差レベル)だったが、`flights.csv`(336,776行)では**約1,052ms**。行数は6.2倍なのに時間は0→1秒超と非線形に跳ね上がっており、単純な行数比例ではなく、ある規模を超えたところでV8のGC/最適化上のコスト(オブジェクト生成量の増加など)が乗っている可能性が高い(未特定)。
- Reactの`<Profiler>`が報告する`actualDuration`(`Table`コンポーネントのレンダー): **約1,058ms**(`getRowModel`の実測とほぼ一致、Reactのレンダーコストの大半が`getRowModel`だと裏付けられる)。
- 上記(Reactのレンダー)だけでは全体の`update-data render`計測値(2,987ms)を説明しきれず、**差分の約1.9秒はReactのコミット(DOM反映)〜ブラウザのレイアウト/ペイントの間で消費されている**と考えられる(未特定、`TableVirtuoso`初期マウント時のDOM構築・レイアウト計算などが候補)。
- 上記の一時計測コード自体は、レンダーの度にIPC呼び出しが増える(`Profiler`の`onRender`は再レンダーの度に発火する)ため常設せず、調査後に元に戻した。再調査する場合は同じ手法(`useMemo`/主要処理呼び出し箇所への一時計測、`<Profiler>`の`onRender`)を再度仕込めばよい。

## 今後の対応方針(2026-07-27、ユーザーとの相談結果)

上記の内訳を踏まえ、各コストは「ページング化」以外にも縮める手段があり、それぞれ効果・実装規模・トレードオフが異なる。ユーザーと相談の結果、以下の方針とした。

- **サーバー側ページング化は今のところ見送り**。仮想スクロール(全件ロード+即座にクライアント側でソート/フィルタ/セル範囲選択できるUX)を維持する方を優先する。ただし、下記の対応をやってもなお速度が不十分な場合は、改めて検討の余地を残す。
  - **(訂正、2026-07-27追記)** 下記②(JSON→Arrowバイナリ転送)を実装・検証した結果、「見送ってもなお速度が不十分」な状況に実際に該当することが分かった。詳細は②の項目と、本ドキュメント末尾の「サーバー側ページング化の再検討(2026-07-27)」を参照。
- ✅ **① 仮想化ライブラリの統一(issue #8、`react-virtuoso`→`@tanstack/react-virtual`)対応済み(2026-07-27)**。`TableVirtuoso`を`useVirtualizer`+spacer行方式に置き換え、既存のPin列・D&D・セル範囲選択・CSVエクスポートは無回帰で移行。これは速度改善そのものが目的の対応ではなく、ライブラリ統一・計測の土台安定化が主目的。`flights.csv`(33万行)でのフロントレンダリング時間は移行前後で約2,987ms→約1,466msだったが、**それぞれ1回ずつの計測**であり、このマシンでの計測値は同じコードでも系(裏で動くビルド等)の負荷次第で大きくばらつくことが分かっている(本ドキュメント内の`extract_data`計測でも653ms〜13,556msの振れ幅が出ている)ため、「ライブラリ変更で速くなった」と因果関係を主張できるほどの根拠はない。詳細な実装メモ(レイアウトの循環参照によるパフォーマンス崩壊とその修正など)は`overview.md`の「Grid表示の仮想化ライブラリ統一(issue #8)」を参照。移行中に見つかったキーボードスクロール追従の課題は[issue #21](https://github.com/mizulo-olmizu/data_viewer/issues/21)として切り出した。
- 🔍 **② JSON→Arrowバイナリ転送への変更 検証したが見送り(2026-07-27)**。`extract_table`/`execute_query`の戻り値を、Arrow→JSON文字列から「Arrow IPC stream形式のバイト列」に変更する実装を行い(`QueryResult::into_arrow_ipc_bytes`(`db/src/lib.rs`、`arrow-ipc`クレート)でRecordBatchをArrow IPCバイト列に変換、`[4バイトLE u32のメタデータ長][メタデータJSON][Arrow IPCバイト列]`というバイナリフレーミングで`tauri::ipc::Response`に渡し、フロント側は`apache-arrow`(npm)の`tableFromIPC`でArrow Tableに変換した上で既存の`DataFrame`(`Row[]`)形式へ変換する設計)、実際にRust側の変換速度が約4倍(`flights.csv`336,776行・19列、release build、`into_json_string` 205〜234ms→`into_arrow_ipc_bytes` 49〜54ms、転送バイト数も104.5MB→49.7MBと半減)になることまでは確認できた。**しかし、フロント側(JS)のデコードコストまで含めて計測したところ、旧JSON方式より大幅に遅くなることが判明し、実装ごと差し戻した**(コードは残っていない、この記録のみ)。
  - **フロント側実測(Node.js/V8での計測、実機のJavaScriptCoreとは特性が異なるが目安として)**: 旧方式は`JSON.parse`のみで約330ms。新方式は`tableFromIPC`+行オブジェクトへの変換で約1,335ms(4倍以上遅い)。合計で見ると旧方式(Rust 205〜234ms+JS 330ms≈540〜560ms)に対し、新方式(Rust 50〜54ms+JS 1,335ms≈1,400〜1,450ms)は約2.5倍遅く、Rust側の高速化分を大きく上回る形でフロント側が悪化し、**トータルでは明確な劣化**だった。
  - **原因1: apache-arrowの`Table`レベル`Vector.get(row)`のチャンク探索コスト**。DuckDBの`query_arrow()`はこの行数だと内部vector sizeにより約165個の小さいRecordBatchに分割してArrowデータを返す。`Table`に平坦化した状態で`.get(row)`を呼ぶと毎回「どのチャンクに属するか」を解決する必要があり、6.4M回(33万行×19列)のセルアクセス全てにこのオーバーヘッドが乗る。`RecordBatch`単位でイテレートする(各バッチ内は1チャンクなので探索不要)ことで1,335ms→790〜850msまでは改善したが、それでも旧方式より遅い。
  - **原因2: BIGINT列のbigint変換コスト**。DuckDBのCSV型推論は整数列をデフォルトでBIGINTにするため(`flights.csv`は19列中10列がBIGINT)、apache-arrowが返す`bigint`をセルごとに`Number`変換するコストが積み上がる。旧`arrow_json`(Rust)は同じ変換をC++寄りの実装で高速に行っていたのに対し、JS側で同等のことをすると相対的に遅い。
  - **検討した代替案: 遅延変換(必要な行だけ変換する)**。Arrowの`Table.toArray()`はアクセスされるまで実際の値変換をしない軽量プロキシ配列を返せるため、これをさらに`Proxy`でラップして「アクセス時にだけ型変換する」形にし、仮想スクロールで実際に画面に出る行(先頭50行程度)だけアクセスするケースを計測したところ、**0.4〜2.5ms(ほぼ無視できるコスト)**だった。初期表示だけを見れば劇的に速くなる可能性がある一方、全体検索・全件CSVエクスポート・列ソートなど「結局全行を触る」操作をした瞬間に遅延していたコストをまとめて払うことになり(Proxyオーバーヘッドも乗るため全件アクセス時は1,645〜4,252msとむしろ悪化)、「重い処理をいつ払うか」を移動させるだけで根本解決にはならないと判断した。
  - **結論**: JSON⇄Arrowのようなエンコード方式の工夫だけでは、「DuckDBから取得した全行をJSオブジェクトとしてJS側に持ってくる」という構造そのものが持つコストの頭打ちを超えられない。DuckDB自体は`flights.csv`の全件スキャンを0.33秒でこなせる(本ドキュメント冒頭参照)ため、ボトルネックは常にエンジンではなく「プロセス境界を越えてJSオブジェクト化する」部分にある。この教訓を踏まえ、**サーバー側ページング化(DuckDBにソート/フィルタ/ページングを任せ、JS側には常に画面表示分の少量データしか渡さない設計)を優先度最上位に引き上げる**方針とした(詳細は本ドキュメント末尾の「サーバー側ページング化の再検討」を参照)。ページング化後は1リクエストあたりの行数が小さくなるため、JSONかArrowバイナリかという選択自体の重要性はほぼ無くなる見込みで、実装のシンプルさを優先しJSON方式(①で確立済み)を維持する。
- **③ `summarise`の列並列化**: 現状19列分の集計クエリを`schema.iter().map(...)`で逐次(1列ずつ順番に)実行しているが、DuckDBは複数コネクションでの並列クエリ実行に対応しているはずで、列ごとに並列実行すればコア数(検証環境で8)近くまでスケールし、約1.6秒を大きく縮められる可能性がある(未検証)。着手コストの見積もりが低い割に効果が見込める候補。
  - **(訂正、2026-07-28追記)** 下記「対応方針・優先順位」節で、この項目を「複数回スキャンの削減」(カラムごとのSQL発行回数を減らす、別の最適化)と同じ「③」として扱い「優先度は最も低い」と結論していたが、これは番号の使い回しによる誤り。両者は別の最適化であり、列並列化はサーバー側ページング化(2026-07-27対応済み、`feature/perf-timing-logs`ブランチ)により前提が変わったため、優先度を再評価する必要がある。詳細は「対応方針・優先順位」節の訂正を参照。

**検討したが今回は見送った/保留にした手段(メモ、必要になったら再検討):**
- `getRowModel`の高速化(`accessorFn`内`serialize()`呼び出しの削減など): 行数に比例する土台コストの地道な最適化。効果は限定的と見られ、優先度は低い。
- `TableVirtuoso`初期マウント時のコミット/ペイントコスト(未特定の約1.9秒)の深掘り: 仮想化ライブラリ統一(①)後に一度だけ再計測したところ約1,466msだったが(前述の通り1回の計測で因果関係を主張できるものではない)、内訳(Reactのレンダー/コミット/ブラウザのペイントそれぞれの割合)は再計測していない。さらに追及する場合は、複数回計測して振れ幅を把握した上で、以前と同様に`Table.tsx`へ一時的な計測コード(`<Profiler>`・`useMemo`/`getRowModel`呼び出し箇所への計測)を仕込んで切り分ける。
- `summarise`のクエリ統合(performance.mdの③、複数SQLを1つにまとめる): 実測で影響が小さいと分かっているため優先度低い。
- Summaryタブを開くまで集計を遅延させる(遅延評価によるUX変更): 集計自体のコストを減らすわけではなく体感を変えるだけなので、②③をやってもなお不十分な場合の追加候補として保留。
- サンプリングによる近似統計: 精度とのトレードオフを伴う製品判断のため、必要になったら改めて検討。

## 現状の課題

### 🟡 メインテーブル表示: 全件ロード + JSON多段変換

- ✅ **変換パイプラインの高速化(2026-07-27対応済み)**: `QueryResult::into_json`(Arrow→JSON bytes→`Vec<Map<String,Value>>`変換)を`into_json_string`(Arrow→JSON bytesの結果をそのまま文字列として返す)に置き換え、`handler.rs`側での`serde_json::to_string(&df)`という二重目の文字列化も廃止した(`extract_table`が`(df_json, row_count)`を直接返す)。
- ✅ **IPC転送方式の見直し(2026-07-27対応済み)**: `extract_table`/`execute_query`コマンドの戻り値を`tauri::ipc::Response`に変更。`extract_data`が`name`/`schema`/`summary`/`df`を手組みの文字列連結で1つのJSONオブジェクトテキストに組み立て(`df`部分は既に妥当なJSON配列テキストなのでエスケープし直さない)、それをそのままレスポンスbodyとして返すことで、Tauriのコマンド戻り値シリアライズによる二重JSONエスケープを回避した。フロント側の`response.json()`(webview組み込みのネイティブパーサ)が最初からパース済みオブジェクトを返すため、`src/handler.ts`の`JSON.parse(result.dfJson)`という手動の二度目のパースも不要になった。実測結果は上記「対応①実施後の再計測結果」を参照(`flights.csv`で`extract_data`合計17.76秒→5.14秒、フロント`invoke`往復23.3秒→6.9秒)。
- ⬜ **サーバー側ページング化(未対応)**: `extract_table`（`db/src/lib.rs`）にoffset/limit引数が無く、常に`SELECT * FROM {table_name}`で全件取得する仕組みは変わっていない。`src/Table.tsx`（`useReactTable`）も全件を`data`として保持し、`getSortedRowModel`/`getFilteredRowModel`でソート・フィルタを毎回クライアントJS側で全行処理する。`react-virtuoso`による仮想化はDOM描画の間引きのみで、データ取得自体は仮想化されていない。
- → 変換パイプラインの高速化により、数十万行規模までは実用的な速度になった。ただし2026-07-27のJSON→Arrowバイナリ転送の検証で「エンコード方式の工夫だけでは頭打ちになる」ことが判明したため、サーバー側ページング化（＋サーバー側ソート/フィルタへの切り替え）は「必要性が生じたら着手」から「優先度最上位」に格上げした。既存機能（セル範囲選択・CSVエクスポート・RecordViewの行ジャンプなど、いずれも「全件がJS配列上にある」ことに依存）への影響が大きいため、着手時はまず影響範囲の洗い出しから設計する。詳細は本ドキュメント末尾の「サーバー側ページング化の再検討」を参照。

### ⬜ numeric_summariseでのヒストグラム用生データ全送信

- `numeric_summarise`（`db/src/lib.rs:522-594`）は、統計量(min/max/quantile/mean/std)をSQL集計で計算し（これは適切）、`binning`（583行目）でヒストグラムのビンもSQL側で計算済みにもかかわらず、`extract_raw_column`（585行目）で列の生データも丸ごとRust側に取得している。
- `extract_raw_column`（506-520行目）は`SELECT {col} FROM {table}`で列の生データを全件取得し、`NumericSummary.raw`（`types.ts:90`）としてフロントへ送信される。
- **(訂正、2026-07-27実測時に判明)** 当初「ビンが既に計算済みなら生データは本来不要な無駄」と書いたが、実際には`raw`は死んでいるデータではなく、`SummaryDisplay.tsx`のヒストグラムを拡大表示するモーダル(`HistogramChartInteractive`、`src/charts/HistogramChart.tsx`の`binData`)で、ユーザーがビン数をインタラクティブに変更して再ビニングする機能に使われている。単純に送信をやめると、この「モーダルでビン数を変えて見る」機能が壊れる。
- 対応するには、(a)生データの送信を大規模テーブルでは打ち切る/サンプリングする(モーダルの再ビニング精度は落ちるがトレードオフとして許容する)、(b)インタラクティブな再ビニング自体をバックエンドへの再クエリ(`binning`にbin_size指定済みなのでSQLは既にある)に切り替える、のいずれかの設計判断が必要。
- **(訂正、2026-07-28追記)** 当初「`extract_table`(全件取得+JSON変換)の方が支配的コストであり優先度は①より低い」と書いたが、①(サーバー側ページング化)対応済みにより`get_table_metadata`がdfを含まなくなった今、summarise(生データ送信込み)がテーブルを開く際の支配的コストになっている(詳細は「対応方針・優先順位」節の訂正を参照)。ユーザーと相談の結果、(b)バックエンドへの再クエリに切り替える方針で合意し、次のセッションで着手する。既存の2次元可視化(未実装)にも同じ「サーバー側で計算し、フロントには表示分だけ渡す」方針を適用する。

### ⬜ カラム集計・クエリ実行のたびの複数回フルスキャン

- `numeric_summarise`はカラムごとにstats/binning/raw(生データ)で3回、`string_summarise`/`boolean_summarise`（609-644, 646-672行目、`value_counts`(474-504行目)使用）は2回、独立したSQLを発行している。カラム数×複数回のフルスキャンになる。
- `execute_query`（`handler.rs:196-212`）はクエリ実行のたびに一時テーブル`_last`へ`CREATE OR REPLACE`し、`extract_data`で全件抽出＋全カラム再サマライズを行う。クエリ結果が大きいほど毎回のコストが増す。
- **(訂正、2026-07-28追記)** 上記のヒストグラム生データ送信削減(②)に着手すれば、`numeric_summarise`のraw取得分のクエリが1本減る。②と合わせて設計するのが手戻りが少ない。

### ✅ DuckDB接続のメモリ/スレッド設定(2026-07-27調査の結果、対応不要と判断)

- `DbState::try_new`（`db/src/lib.rs:213-220`）は`Connection::open`/`open_in_memory`のみで、明示的な`PRAGMA memory_limit`/スレッド数設定は行っていない。
- **(訂正)** 当初「無制御なメモリ使用のリスクがある」と書いたが、これはコードリーディングのみに基づく推測で、実測せずに書いたものだった。実際にDuckDB CLI(このリポジトリと同じ`duckdb`クレート系統)で`current_setting('memory_limit')`/`current_setting('threads')`を確認したところ、明示指定が無くてもDuckDBは自動的に**システムRAMの約80%**・**論理CPUコア数**をそれぞれ`memory_limit`/`threads`のデフォルトに設定していた(検証環境: RAM 16GB→memory_limit 12.7 GiB、8コア→threads 8)。つまり「無制御」ではなく、既にハードウェアに応じた妥当な動的デフォルトが入っている。
- 固定値(例:「4GB」「4スレッド」)を明示的に設定することも検討したが、これは環境によって最適値が異なるため(RAMが多いマシンでは無駄に制限し、少ないマシンでは焼け石に水になる)、DuckDB自身の動的デフォルト(ハードウェアに比例)より劣る。
- DataViewerはデータ分析・可視化の速度を重視するツールであり、「他アプリとの共存のためにメモリ使用を控えめにする」よりも「使えるリソースを積極的に使って速くする」方が製品の目的に合致するとの判断から、DuckDBのデフォルト設定をそのまま使う方針とした。明示的な設定変更は行わない。

## 対応方針・優先順位

実測により、①(メインテーブルのページング化、特に`extract_table`のArrow→JSON変換とIPC転送)が支配的コストであることが定量的に裏付けられた。うち「変換パイプラインの高速化」「IPC転送方式の見直し」の2点は2026-07-27に対応済み(`flights.csv`で`extract_data`合計17.76秒→5.14秒、フロント`invoke`往復23.3秒→6.9秒、約3.4倍高速化)。残る優先順位は以下の通り。

- ✅ **① サーバー側ページング化(2026-07-27対応済み)**: JSON→Arrowバイナリ転送(②)を検証した結果、エンコード方式の工夫だけでは頭打ちになることが判明したため、既存UX（即時クライアントサイドソート/フィルタ）を変える設計判断を伴う本命の対応として優先度を最上位に引き上げ、本格実装した(`feature/perf-timing-logs`ブランチ、詳細は下記「サーバー側ページング化 本格実装」を参照)。仮想化ライブラリの統一(issue #8、`react-virtuoso`→`@tanstack/react-virtual`)は既に対応済みのため、これと合わせた設計は不要になった。
- **④ DuckDB接続のメモリ/スレッド設定**は調査の結果、DuckDB自身の動的デフォルト(RAM比率・コア数に応じた自動設定)が既に妥当であり、パフォーマンス重視の方針とも合致するため対応不要と判断(2026-07-27)。

**(訂正、2026-07-28追記)** 以下の②③の優先度は、いずれも「①のページング化前は`extract_table`のArrow→JSON変換とIPC転送が支配的コストで、summarise・生データ送信はその影に隠れて相対的に小さかった」という前提に基づいていた。①が2026-07-27に対応済みとなり、`get_table_metadata`(旧`extract_table`)が全行データ(df)を含まなくなった結果、**summarise(19列合計で約1.6秒)がテーブルを開く際の支配的コストになった**(実測: `build_table_metadata_json`全体で1.7〜2.3秒、その大部分をsummariseが占める)。前提が変わったため、②③の優先度を以下の通り再評価する。

- ✅ **③ summariseの列並列化(2026-07-28対応済み)**: 上記の理由により、ページング化前は「全体の1割未満」だったsummariseのコストが、ページング化直後は「テーブルを開く時間のほぼ全て」になっていた。列ごとの逐次実行を並列化することでコア数近くまでスケールした。詳細・実測は本ドキュメント末尾の「summariseの列並列化 実施後の再計測結果」を参照。
- **② 生データ送信の削減/ヒストグラムのサーバー側計算化(方針決定、2026-07-28)**: 機能(インタラクティブ再ビニング)とのトレードオフがあり保留していたが、ユーザーと相談の結果、「DuckDB側で計算し、フロントには表示分だけ渡す」という①と同じ方針をチャート/集計全般(既存のヒストグラム再ビニング、および未実装の2次元可視化)にも広げる方向で合意した。インタラクティブ再ビニングは生データ送信(`extract_raw_column`)をやめ、ビン数変更のたびにバックエンドの`binning`(bin_size引数を取れるか要確認)へ再クエリする設計に変更する。集計クエリ自体は数ms〜数十ms(本ドキュメント冒頭の実測参照)のため、レイテンシ増は軽微と見込む。設計・実装は次のセッションで着手する(詳細は本ドキュメント末尾の引き継ぎメモ、および着手時は`docs/design/overview.md`のロードマップも確認すること)。
- **複数回スキャンの削減**(カラムごとにstats/binning/rawを個別クエリで発行している点、上記「③」とは別の最適化)は、②(生データ送信の削減)に着手すればraw取得分のクエリが1本減るため、②と合わせて設計するのが手戻りが少ない。単独での優先度は低いまま。

## サーバー側ページング化の再検討(2026-07-27)

JSON→Arrowバイナリ転送(②)の検証を通じて、「DuckDBから取得した全行をJSオブジェクトとしてJS側に持ってくる」という構造自体が速度の天井になっていることが分かった。DuckDB自体は高速(`flights.csv`の全件スキャンが0.33秒)なので、エンジンをもっと活用し、JS側には常に画面表示分の少量データしか渡さない設計に寄せるのが筋が良いという結論に至った。

大規模データで快適に動作する既存ツールの多くも同様の設計を取っている(ユーザーとの相談で確認):
- DBeaver/TablePlus/pgAdmin系: 1ページ(数百〜数千行)ずつDBから取得し、ソート・フィルタもSQLに変換してDB側で実行する。
- Perspective(FINOS/J.P.Morgan製、大規模データのインタラクティブ可視化向けOSS): C++/WASMの列指向エンジンをフロント内に持ち、ソート・フィルタ・ピボットは全部そのネイティブ層で行い、実際に描画される可視領域分だけをJS/DOMに渡す。
- duckdb ui/Rill/Evidence.dev等のDuckDB UI系ツール: SQLエンジン(DuckDB自体)がページング・ソート・フィルタを担当し、フロントは表示専任。

共通しているのは「JS側に大量の行をオブジェクトとして持たせない」という点。DataViewerは既にDuckDBをin-processで持っているため、この方向に寄せるのが最もこのアプリの強みを活かせる。

### 転送方式(JSON vs Arrow)への影響

ページング化すると1リクエストあたりの行数が数百行程度に収まるため、JSON⇄Arrowの変換コスト差はほぼ意味を失う(数百行×20列程度ならどちらの方式でも数ms〜数十ms)。実装のシンプルさ(依存追加なし、型変換の落とし穴が無い)を優先し、**転送方式はJSON(①で確立済みの`tauri::ipc::Response`+文字列連結方式)を維持する**。Arrow IPCバイナリが再び意味を持つとしたら「HTTP/MCP経由で他ツール(Python/R等)が直接Arrowを読みたい」といった別の要求からであり、現時点のスコープには無い。

### 影響範囲(設計時に洗い出しが必要)

「クライアント側で全行を即座にソート/フィルタ/セル範囲選択/CSVエクスポートできる」という現状のUXが、「全件がJS配列上にある」ことに暗黙に依存しているため、以下がページング化の影響を受ける可能性が高い:
- `src/Table.tsx`(`useReactTable`の`data`、`getSortedRowModel`/`getFilteredRowModel`)
- グローバル検索・高度フィルタ(現状は全列全行に対してクライアント側で評価)
- セル範囲選択・コピー(`useCellRangeSelection.ts`、選択範囲がロード済みデータに依存)
- CSVエクスポート(現状はロード済みJS配列をそのままCSV化。DuckDBの`COPY ... TO`に置き換えられる可能性がある)
- `src/GlimpseView.tsx`・`src/RecordView.tsx`(行ジャンプ・全件表示)

着手する際は、まずこれらの影響範囲を洗い出した上で設計から始める(本ドキュメントの範囲を超えるため、別途プランニングする)。
- 着手タイミングは`overview.md`のロードマップを参照。要約表示の2次元可視化（フェーズ3）が加わると新たな集計クエリが増え、速度面の懸念が追加で出てくる可能性が高いため、2次元可視化の実装が一段落してからまとめて着手する方針とする（一度に検証する方が手戻りが少ない）。

## サーバー側ページング化 POC(技術検証)の結果(2026-07-27)

本格実装は、セル範囲選択のページ跨ぎコピー・CSV全件エクスポート・RecordViewの行ジャンプなど「全件がJS配列上にある」前提に依存する機能の大幅な再設計を伴う大きな作業になるため、まず技術的な実現性だけを検証するPOCを実施した(`feature/perf-timing-logs`ブランチ)。既存の`Table.tsx`本体には手を入れず、隔離された「Paged (POC)」タブとして実装した(D&D列並び替え・Pin・セル範囲選択・CSVエクスポートは対象外)。

### 実装内容

- `db/src/lib.rs`: `DbState::extract_table_page`(`SELECT * FROM {table} {WHERE} ORDER BY {col} {ASC|DESC}, rowid LIMIT {limit} OFFSET {offset}`)・`count_table_rows`を追加。`ORDER BY`には常に`rowid`をタイブレーカーとして付与し、ページ境界での行の重複/欠落を防止。
- `handler.rs`: 軽量スキーマ取得コマンド`get_table_schema`(既存の`extract_table`はsummary計算込みで`flights.csv`規模だと数秒かかるため使い回さない)と、`extract_table_page`コマンド(`{df, totalRows}`を返す)を追加。
- `src/PagedGridPoc.tsx`: `useVirtualizer({count: totalRows})`+`Map<number, Row>`によるページ単位キャッシュ。可視範囲の変化を120msデバウンスしてからフェッチ(単一DB接続が`Mutex`で直列化されているため、高速スクロール中の大量in-flightリクエストによるhead-of-line blockingを避ける狙い)。generationカウンタはソート/フィルタ条件が変わった時のみインクリメントし、ページフェッチのたびには増やさない(同一条件下での並行フェッチを誤って破棄しないため)。フィルタは自動生成UIではなく生のWHERE句を直接入力する簡易版。

### 検証結果

`flights.csv`(33万行)で以下を確認し、いずれも問題なし(ユーザーによる実機確認、体感評価):
- スクロールバーを深い位置(30万行目付近)までドラッグしてジャンプした際の反応
- 列ソートした状態で同様に深い位置へスクロールした際の反応(`ORDER BY`併用時)
- WHERE句入力欄に条件(例: `DepDelay > 60`)を入れた際の反応
- 通常速度でのスクロール時のちらつき・カクつきの有無

「全体的に快適で問題なさそう」という評価で、DuckDB側のOFFSET/LIMIT/ORDER BY/WHERE処理・スクロール時の追加フェッチという設計方針の技術的な実現性が確認できた。詳細なレイテンシのms単位計測(`app_log_perf`への正式な統合)は行っていない(POCの位置づけのため簡易確認に留めた)。

### 結論・次のステップ

技術的な実現性が確認できたため、本格設計(`Table.tsx`本体の置き換え、セル範囲選択のページ跨ぎ対応、CSV全件エクスポートのDuckDB `COPY TO`化、RecordViewの行ジャンプの再設計など、上記「影響範囲」節を参照)に進む価値があると判断する。着手タイミングは引き続き`overview.md`のロードマップに従う(2次元可視化が一段落してから)。POCコード自体(`PagedGridPoc.tsx`等)は技術検証用の簡易実装であり、本格設計時にそのまま採用するとは限らない。

## サーバー側ページング化 本格実装(2026-07-27、`feature/perf-timing-logs`ブランチ)

POCの検証結果を受け、ユーザーの指示により2次元可視化を待たず本格実装に着手した(GlimpseViewも対象に含む、明示的な指示あり)。

### 設計方針

`Table.tsx`/`GlimpseView.tsx`/`RecordView.tsx`はTanStack Tableの`useReactTable`インスタンス(列の表示/非表示・並び替え・Pin・ソートUIの状態管理)を共有しているため、これを丸ごと作り替えるとD&D・Pin・セル範囲選択など既存機能への回帰リスクが大きい。そこで「プレースホルダー配列」設計を採用した: `useReactTable`に渡す`data`配列の長さを常に`totalRows`(サーバー側フィルタ後の総件数)に保ち、未ロードの行は共有の空オブジェクト`LOADING_ROW`で埋めておき、ロード済みの行だけ実データに差し替える。これにより`row.index`が常に「サーバー側ソート/フィルタ済み結果内での絶対位置」と一致し、既存の行番号表示・仮想化のcountがほぼ無改造で使える。共有フック`src/usePagedRows.ts`がこの管理を担う。

- ソート列見出しのクリック・検索ボックス(グローバル検索)・高度フィルタは、SQLのORDER BY/WHERE句に変換してサーバー側で評価する(`src/advancedFilter.ts`の`conditionsToSql`/新設`globalSearchToSql`)。
- `getCoreRowModel()`はTanStack Table v8の仕様上、`data`配列の参照が変わるたびに総行数分のRowラッパーを再生成する(可視ウィンドウの大きさとは無関係のO(N)コスト)。ページ到着のたびに参照を差し替えるとこのコストを何度も払うため、`usePagedRows`は参照の差し替え(`setData`)自体を`requestAnimationFrame`で1フレームに1回にコアレスしている。
- セル範囲選択のコピーは、選択範囲が未ロードの行を含みうるため`fetch_row_range`コマンド(1クエリで選択範囲・列を取得)を使い、ページキャッシュは経由しない。選択行数が5万行を超える場合は確認ダイアログを挟む(Cmd+A・ドラッグ・Shift+矢印キーいずれの選択方法でも同じ基準で判定)。
- CSV全件エクスポートは、DuckDBの`COPY ... TO ... (FORMAT CSV, HEADER)`をRust側で直接実行する新規コマンド`export_table_csv`に置き換えた。JSにデータを一切渡さないため、ロード済みかどうかに関わらず全件を高速にエクスポートできる。

### 実測

`get_table_metadata`(schema+summary+totalRowsのみ、dfを含まない)は`flights.csv`(33万行)で約1.8〜2.3秒(旧`extract_table`は数秒〜十数秒)。

### 検証で見つかった問題と切り分け(2026-07-27)

実機確認で、GlimpseView・RecordViewにおいて「未訪問の遠い絶対位置に一気にジャンプする」操作(GlimpseViewのスクロールバードラッグ、RecordViewのRandomボタン/スライダー)の際に、ウィンドウが白くなりアプリが再初期化されたように見える現象が発生した。macOSの「コンソール」アプリのクラッシュレポートを確認したところ、`com.apple.WebKit.WebContent`プロセスが`WebCore::CloneSerializer::write`(構造化クローンのシリアライズ処理)内で`EXC_BAD_ACCESS(SIGBUS)`によりクラッシュしていた。バックトレースは`performance.measure()`呼び出し経由(`WebCore::PerformanceUserTiming::measure`→`WebCore::jsPerformancePrototypeFunction_measure`)であることを示していた。

調査の結果、これは**React 19の開発ビルド(`react-dom/cjs/react-dom-client.development.js`)が内部で持つ「コンポーネントのレンダー計測」機能(Chrome DevTools Performanceパネルとの連携用トラック、`supportsUserTiming`は`performance.measure`の存在だけで判定されるためDevTools拡張の有無に関わらず常時有効)が、コミット(再レンダー)のたびに`performance.measure()`を呼んでおり、このMac上の特定のWebKitビルドとの組み合わせでレアにクラッシュする**という、アプリのロジックとは独立した環境要因であることが判明した。今回のページング化の実装(深い未訪問位置へのジャンプで短時間に多くの再レンダー=`performance.measure`呼び出しが発生する)がこのクラッシュを引き当てる確率を統計的に上げていたが、原因そのものはコードのバグではない。

本番ビルド(`npm run tauri build`)でユーザーが同じ操作(GlimpseViewの深いスクロールバードラッグ、RecordViewのRandomボタン)を確認したところ、問題は再現しなかった。本番ビルドのReactは開発ビルドと異なりこの計測機能を含まないため、整合する結果である。**開発時(`npm run tauri dev`)にGlimpseView/RecordViewで深い位置への一気なジャンプを行うと、まれにWebKitのクラッシュでウィンドウが再初期化されることがあるが、これは既知の環境要因であり、本番ビルドでは発生しない**、という結論で確認を終了した。今後同種の症状に遭遇した場合は、まずこのセクションを参照し、本番ビルドで再現するかどうかを最初に確認すること。

## summariseの列並列化 実施後の再計測結果(2026-07-28、`feature/perf-timing-logs`ブランチ)

サーバー側ページング化により`get_table_metadata`がdf(全行データ)を含まなくなった結果、列ごとのsummarise(19列合計で約1.6秒、`handler.rs`の`schema.iter().map(...)`による逐次実行)がテーブルを開く際の支配的コストになっていた。これを解消するため、列ごとの集計クエリを並列実行するよう変更した。

### 実装内容

- `db/src/lib.rs`に`DbState::summarise_all(table_name, schema)`を新設。従来`handler.rs`の`build_table_metadata_json`にあった「dtypeごとに`numeric_summarise`/`temporal_summarise`/`string_summarise`/`boolean_summarise`/`other_summarise`を呼び分ける」ロジックをdb crate側に移した。
- DuckDBの`Connection`は`Send`だが`Sync`ではない(内部に`RefCell`を持つ)ため、`&DbState`を複数スレッドから同時参照する形の並列化はコンパイルできない。そのため、並列化に入る前に`Connection::try_clone()`(同一データベース、in-memoryの場合も含めて共有する新しいコネクション)を**逐次**用意し、各コネクションの所有権を`rayon`の`into_par_iter()`タスクへそのまま渡す設計にした(`DbState::try_clone`を追加)。`try_clone()`されたコネクション同士は同じデータベースを見るため、集計に必要な既存のテーブル・ビューはそのまま参照できる。
  - `try_clone()`はテーブルデータ自体(バッファプール・カタログ)を複製するわけではない。`duckdb`クレートのソースを確認すると、実データは`Arc<Mutex<DatabaseHandle>>`として共有されたまま、新しい軽量なクライアント接続(`duckdb_connect`)を1本張るだけであり、追加コストは接続あたりの小さな状態(空の`StatementCache`等)程度でデータ量に比例しない。
  - 当初は列数分そのままコネクションを複製する実装にしていたが、列幅の広いテーブルでは実際に同時実行できるコア数を大きく超えるコネクションを無駄に張ってしまう(レビューで指摘)。コネクション数を`rayon::current_num_threads()`で頭打ちにし、列をワーカー数でチャンク分割して各チャンクを1コネクションで逐次処理する設計に修正した(`chunk_size = schema.len().div_ceil(num_workers)`)。
- `rayon`をdb crateの直接依存に追加(`duckdb`/`arrow`経由で既にビルドグラフには存在していたバージョンと同じ1.12系)。
- `handler.rs`の`build_table_metadata_json`は、列ごとのタイミング計測(`PerfLog`への記録)を`summarise_all`の戻り値(`Vec<(ColumnSummary, Duration)>`)から組み立てる形に単純化した。

### 実測

`flights.csv`(33万行・19列)で、`build_table_metadata_json`全体の所要時間が**約1.7〜2.3秒→114〜158ms**に短縮した(このマシンの計測値は系の負荷次第でばらつくため目安として扱う)。並列化前にsummariseが占めていた「テーブルを開く時間のほぼ全て」というコストは解消された。

### テスト

`db/src/lib.rs`に`summarise_all_preserves_column_order_and_matches_individual_summarise`を追加。`summarise_all`の戻り値がスキーマと同じ列順であること、個別に`numeric_summarise`を呼んだ場合と集計結果が一致すること(並列化しても値そのものは変わらないこと)を検証する。

## ヒストグラム/棒グラフのインタラクティブ機能をサーバー側計算に移行(2026-07-28、`feature/perf-timing-logs`ブランチ)

`numeric_summarise`は、統計量とビン(SQL集計済み)に加えて`extract_raw_column`で列の生データを丸ごとRust側に取得し、`NumericSummary.raw`/`TemporalSummary.numericRaw`としてフロントへ送っていた。これは`HistogramChartInteractive`(詳細モーダル)がビン数変更・範囲フィルタのたびにクライアント側で再ビニングするために必要だったが、summariseの列並列化(上記)によりテーブルを開く際の支配的コストが解消された今、この生データ送信自体がボトルネックの一つとして残っていた。ユーザーとの相談で、「DuckDB側で計算し、フロントには表示分だけ渡す」という方針(①サーバー側ページング化と同じ考え方)をヒストグラム・棒グラフ・今後の対話的チャート全般に広げることで合意し、実装した。

設計を詰める過程で、ユーザー自身が実装していた`HistogramChart.tsx`/`ValueCountsChart.tsx`のコードレビューも行い、以下を併せて修正した:
- `Math.min(...arr)`/`Math.max(...arr)`のスプレッド構文 — WebKit環境で大規模配列に対しスタック上限に当たりうる(生データ送信の廃止によりコードごと削除)
- クライアント側`binData`がO(n×binCount)の線形走査だった(同上、コードごと削除)
- ビン数入力にバリデーションが無く、空文字/負数でグラフが無言で消えていた
- 定数列(全部同じ値)だと範囲スライダーの`step`が0になっていた
- `ValueCountsChart`の`otherIndex && i == otherIndex`が、`otherIndex === 0`のケースでfalsyになる位置ベース判定のバグ

さらに調査の過程で、`value_counts()`にLIMITが無く、高カーディナリティな文字列列(ほぼ一意なID列等)だと実質行数分の値リストがフロントに送られうる状態を発見。ユーザーの指示で同じ対応に含めて解消した。

### 実装内容(バックエンド)

- `NumericSummary.raw`/`TemporalSummary.numericRaw`を完全に削除。`extract_raw_column`は使用箇所が無くなったため削除。
- `DbState::binning`に`range: Option<(f64, f64)>`引数を追加。`Some((min, max))`の場合、`base`のCTEに`WHERE {col_expr} BETWEEN {min} AND {max}`を追加し、`stats`のmin_value/max_valueは統計として再計算せず渡されたmin/maxを`MIN()`/`MAX()`でラップして使う(**ハマった点**: 単なるリテラルだと集計関数でないため`FROM base`の行数分だけ複製されてしまい、後段の`(SELECT min_value FROM stats)`スカラーサブクエリが「複数行返却」エラーになった。`MIN(min)`のように集計関数でラップすることで、行数に関わらず必ず1行に収束させる必要がある)。`None`の場合は従来通り列全体min/max・フィルタ無し。
- 新規コマンド`get_numeric_bins`(`handler.rs`): `table_name`, `column_name`, `is_temporal`, `bin_count`, `range_min`, `range_max`を受け取り、`is_temporal`なら`epoch_ms({col})`を式として`binning`に`Some((range_min, range_max))`付きで渡す。小さい構造体を返すだけなので、大きなJSON文字列の二重エスケープ対策(`tauri::ipc::Response`)は使わず通常の`Result<Vec<NumericBin>, InvokeError>`で返す。
- `ValueCount<T>`に`is_other: bool`フィールドを追加。位置(何番目の要素か)ではなくこのフラグでOther行を判定する設計にすることで、上記の`otherIndex`位置ベース判定バグを根本修正した。
- 新規メソッド`DbState::value_counts_limited`(`string_summarise`専用、`VALUE_COUNTS_LIMIT = 50`): 2クエリ構成にして「top N行 + Other 1行」を超える行を絶対にRust側に読み込まないようにした。1本目でtop N件をLIMIT付きで取得し、2本目で`OFFSET N`した残りの`SUM(count)`だけを1行取得してOther行として追加する(0件なら追加しない)。distinct値がどれだけ多くても、実際にメモリ/IPCに乗る量は定数(N+1件)に収まる。`boolean_summarise`は distinct値が高々3なので既存の無制限`value_counts`のまま。

### 実装内容(フロントエンド)

- `src/useNumericBins.ts`を新設。`usePagedRows.ts`と同じ規約(120msデバウンス+generationカウンタによる古い応答の破棄)を踏襲。初回マウント時は渡された`initialBins`(テーブルを開いた時点で既に計算済みのデフォルトビン)をそのまま使い、ビン数・範囲が実際に変化した時だけ再クエリする。**今後の対話的チャート(2次元可視化等)もこの形(デバウンス+generation guard+初回スキップ)に倣う想定**。
- `HistogramChartInteractive`は`data: number[]`を廃止し、`tableName`/`columnName`/`initialBins`/`initialMin`/`initialMax`を受け取る形に変更。ビン数入力は`Number.isFinite`かつ整数かをチェックし1未満はクランプ、範囲スライダーの`step`は`initialMin === initialMax`のとき1にフォールバックする。
- `ValueCountsChart`/`ValueCountsChartInteractive`は`otherIndex`プロパティを廃止し、各データ項目の`isOther`フラグで色分け・ラベル表示する共通ヘルパー`barLabel`を導入した(Otherの合成行は`value: null`のため、実際に値がnullのカテゴリと表示ラベルが衝突しないよう`"Other"`という別ラベルを与える。band scaleのdomainで重複キーになると2本のバーが同じ位置に重なって描画されてしまうため)。
  - **ハマった点**: 実機確認で、チェックボックスリスト側(`ValueCountsChartInteractive`)がこの`barLabel`ヘルパーを使わず`d.value`を直接表示しており、Other行のラベルが空欄になるリグレッションを見つけた(グラフ本体の色分けは正しく動いていたため気づきにくかった)。チェックボックスリストのラベル表示にも同じ`barLabel`を適用して修正。

### 実測

`flights.csv`(33万行・19列)で、数値列(distance等)のヒストグラムモーダルでビン数変更・範囲スライダーが正しく再クエリされること、`tailnum`(高カーディナリティな文字列列)のモーダルでOtherバケットが正しくグレー表示・ラベル表示されることを実機で確認した。

### テスト

`db/src/lib.rs`に以下を追加:
- `binning_with_range_filters_and_fixes_domain`: range指定時にフィルタが効くこと、ビンの境界がrangeに固定されること
- `value_counts_limited_aggregates_remainder_into_other_row`: 上限を超えた場合のみOther行が追加され、集計値が正しいこと
- `value_counts_limited_omits_other_row_when_within_limit`: 上限以下の場合はOther行が追加されないこと
