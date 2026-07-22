# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## やりとりの言語

ユーザーとの対話は日本語で行う。

## これは何か

DataViewer — ローカルのデータファイル（CSV, TSV, JSON, JSONL, Parquet）を閲覧・クエリするための Tauri v2 製デスクトップアプリ。ユーザーがファイルを開くと（CLI引数、ドラッグ&ドロップ、Finderのファイル関連付け、アプリ内操作のいずれか経由）、そのファイルはインプロセスの DuckDB に読み込まれ、UI上に仮想化されたテーブル、カラムごとのサマリー/チャート、Monacoベースの SQL エディタ（補完・lint付き）が表示される。

## コマンド

フロントエンド（リポジトリルートで実行）:
- `npm run dev` — Vite の開発サーバーのみ起動（Tauriウィンドウは開かない）
- `npm run tauri dev` — アプリ全体を開発モードで起動（Vite + Rustバックエンド + webview）。通常のローカル起動方法はこれ
- `npm run build` — `tsc` による型チェック + Vite の本番ビルド（フロントエンドのみ）
- `npm run tauri build` — 本番用アプリバンドルのビルド

Rustバックエンド（`src-tauri/` で実行）:
- `cargo build` — Tauriバイナリのビルド
- `cargo test --workspace` — 全Rustテストを実行（ルートクレート `data_viewer_lib` + workspaceメンバーの `db`）。テストは `db/src/lib.rs`、`db/src/duckdb_data_type.rs`、`src/modules/handler/sqruff.rs` にある
- `cargo test -p db <test_name>` / `cargo test --workspace <test_name>` — 特定のテストのみ実行
- `cargo clippy` — lint

JS/TS側にはPrettier（`npm run format` / `npm run format:check`、対象はTS/TSX等のコードのみでMarkdownは対象外）とESLint（`npm run lint`、flat config: `eslint.config.js`）を導入済み。`typescript-eslint`・`eslint-plugin-react-hooks`（React Compiler由来のpurity/set-state-in-effect等のルールを含む）・`eslint-plugin-react-refresh`を使用。テストスイートはまだ無い（vitestなし）。フロントエンドの型チェックは `npm run build` 内の `tsc` ステップのみ。

## アーキテクチャ

### 隠れたHTTPサーバーを持つ2プロセス構成

Rust側（`src-tauri/`）は単なるTauri IPCバックエンドではなく、起動時に **axumのHTTPサーバー**（デフォルトポート3000、`-p`で変更可）も同時に立ち上げ、`/update-data` と `/health-check` のルートを持つ。これにより、パッケージ化されたアプリをCLIから2回目以降に起動した場合（例: `dataviewer -i file.csv`）、新しいウィンドウを開く代わりに既存インスタンスへ引数を渡せるようになっている: `tauri-plugin-single-instance` がその再起動を横取りし、通常起動時と同じ方法でargvをパースし、`DbState::register_data` を呼び、フロントエンドに `update-data` というTauriイベントを発火する。macOSの「このアプリケーションで開く」によるファイル関連付けは別経路（`opened_event_listener`、`RunEvent::Opened`）を通る。この3つのエントリーポイント（`setup()` 内の起動時CLI引数、single-instance再起動、macOSのopen-with）はすべて最終的に同じ `register_data` → `update-data` イベント発火という流れに収束するので、ファイル読み込み周りの挙動を変更する際は `src-tauri/src/lib.rs` 内のこの3箇所すべてを確認すること。

### クレート分割: `data_viewer_lib` と `db`

- `src-tauri/db`（workspaceメンバー、クレート名 `db`）: DuckDB/Arrow関連のロジックをすべて持つ、フレームワーク非依存の層。`DbState` がDuckDBのコネクションをラップし、データに関するあらゆる処理を担う — `register_data`（ファイルをテーブルとして読み込む）、`execute`/`execute_with_save`、スキーマ取得、カラムごとの統計サマリー（`numeric_summarise`、`temporal_summarise`、`string_summarise`、`boolean_summarise`、`other_summarise`、`binning`、`value_counts`）など。カラムのdtypeマッピング/パースは `duckdb_data_type.rs` にある。
- `src-tauri/src`（クレート名 `data_viewer_lib`、Cargo workspaceのルートパッケージ）: Tauriとのつなぎ込み層。`src/modules/handler.rs` がフロントエンドから `invoke(...)` 経由で呼ばれる `#[tauri::command]` 関数群（`register_data`、`execute_query`、`extract_table`、`get_table_names`、`get_status`、`get_duckdb_symbols`、`sql_lint`、`sql_fix`、`save_database`、`open_database`）を公開しており、`DbState` を `AppData` でラップしてTauriのmanaged state内で `Mutex` 越しに保持している。
- `src/modules/handler/sqruff.rs`: `sqruff-lib` によるSQL linter/formatterをラップし、Monacoエディタのリアルタイム診断・保存時フォーマットに使われる `sql_lint`/`sql_fix` コマンドを提供する。

### フロントエンドのデータフロー

`src/handler.ts` がReactとRustの唯一の境界であり、すべての `invoke()` 呼び出しとそのレスポンス形式（`ExtractDataResult` → `ExtractDataResultConverted` へ変換、`dfJson` をJSONパースして `DataFrame` にする、など）はここに集約されている。`App.tsx` がトップレベルの状態（現在のテーブルデータ、テーブル名一覧、クエリ、ステータス）を保持し、バックエンドの `update-data` イベント（上記3つのエントリーポイントいずれかから発火される）を監視して新しいファイルが読み込まれたことを検知し、テーブル名と現在のテーブルデータを再取得する。カラム単位のチャート/サマリーコンポーネント（`src/charts/`）は、クライアント側で統計量を再計算するのではなく、Rust側のsummarise関数群が生成する `ColumnSummary` のバリアントをそのまま消費する。

### SQL編集まわり

Monacoの設定は `src/monacoLanguageConfig.ts` / `src/SQLEditor.tsx` にある。シンタックスハイライトと補完は静的なキーワードリストではなく、バックエンドから取得した `DuckdbSymbol`（`getDuckdbSymbols`、内部的には `DbState::get_duckdb_symbols`）を元にしているため、実際に使っているDuckDBのビルドと常に一致する。Lint/フォーマットは `sql_lint`/`sql_fix` を経由し、JS製のSQL linterではなくRust側の `sqruff-lib` を呼び出す形になっている。

## 設計ドキュメント

`docs/design/overview.md` に、実現したい機能一覧・各機能の実装状況（✅/🟡/⬜）・今後の実装ロードマップがまとまっている。機能追加や改善に着手する前にこのファイルを確認し、スコープと優先順位を把握すること。機能の実装が完了したら、該当行のステータスをそのPR内で更新すること（ドキュメントが実態と乖離しないようにするため）。

## 検証フロー

コードを変更したら、基本は以下の軽量なチェックで済ませる。実行に時間がかかる`cargo build`・`npm run build`（フル本番ビルド）は、これらだけでは不十分と判断した場合のみ使う。

- Rust側（`src-tauri/`）: `cargo check` と `cargo clippy` を実行する。
- フロントエンド（TS/React）: `npx tsc --noEmit` で型チェックを行う（`npm run build`はフルビルドまで走るので普段は避ける）。加えて `npm run lint` でESLintを、`npm run format` でPrettierによるフォーマットを揃える（保存時/コミット時の自動化はまだ無いため、変更後に手動で実行する）。

新しいロジックを実装したときはテストも書く。Rust側は既存の`cargo test`の仕組みに沿ってユニットテストを追加する。フロントエンドは現時点でテストフレームワークが未導入だが（下記参照）、導入され次第、`src/utils.ts`のようなロジック部分（データ変換・集計・SQL生成など）は同様にテストを書く方針とする。TauriのIPC（`invoke`）が絡む部分やコンポーネント全体のテストまでは、現状無理に手を広げない。

フロントエンドのテスト基盤（vitestなど）はまだ無い。導入は`docs/design/overview.md`のロードマップ上のタスクとして扱う。

## 動作確認

Tauriアプリはネイティブwebview(macOSではWKWebView)で動くため、Claude Code側からブラウザ経由で自動操作・スクリーンショットを撮ることはできない。フロントエンドの変更を実際の動作で確認したいときは、Bashツールの `run_in_background: true` で `npm run tauri dev` を起動し、開いたウィンドウをユーザー側で目視確認する、という流れをとる。手動で `&` を付けてバックグラウンド化したりPIDを控えたりする必要はなく、再起動したい場合もそのタスクを止めてから起動し直せばよい（`kill`/`pkill`/`ps` を自分で叩く必要はない）。

特定のファイルを読み込ませた状態で確認したい場合は、CLI引数をアプリ本体に渡せる。`npm run tauri dev` は npm 自身が最初の `--` を消費してしまうため、アプリ本体（cargo runで起動される実行ファイル）まで引数を届かせるには `--` を3つ重ねる必要がある:

```
npm run tauri dev -- -- -- -i path/to/file.csv
```

## 開発フロー

作業は必ず`main`から切った作業用ブランチ（新機能に限らず、修正・雑務なども含む。例: `feature/xxx`、`fix/xxx`、`chore/xxx`）上で行い、`main`への直接コミットはしない。作業が完了したらそのブランチをpushし、`gh pr create`でPRを作成する。`main`へのマージはユーザーがPRをレビューした上で行うので、Claude Code側からマージはしない。

## その他

- `src-tauri/tauri.conf.json` にCLI引数（`-i/--input`、`-f/--file-type`、`-t/--separator`、`-n/--name`、`-s/--infer-schema-length`、`-p/--port`、`-d/--db-path`）とファイル関連付けが定義されている。引数を変更する場合は `src-tauri/src/lib.rs` の `MyArgs` と齟齬が出ないよう注意すること。
- `-d/--db-path` は永続化されたDuckDBファイルを開くためのオプションで、ファイルが存在しなければ新規作成される。起動時は `run()` の一番最初で（Tauriの`App`インスタンスがまだ無く`app.cli().matches()`が使えないため）`MyArgs::try_parse_from(std::env::args())` により生のCLI引数から直接読み取り、`AppData::try_new`に渡している。HTTP経由では無視される（`UpdateDataRequest`から`MyArgs`への変換で常に`None`固定、ファイルの登録・更新のみに用途を絞っているため）。single-instance再起動時（既に起動しているアプリに対して`dataviewer -d foo.duckdb`を実行した場合）は即座にDB接続を差し替え、`database-switched`イベントをフロントエンドへ発火してテーブル一覧・データを再取得させる（`open_database`コマンドと同じ「`AppData::dbstate`を丸ごと差し替える」ロジック）。UIの「Open Database」でも同様の切り替えができる。
- クレート構成・エントリーポイント・データフローなど、上記「アーキテクチャ」節の内容に影響する変更をした場合は、同じPR内でこのファイルも更新すること。
