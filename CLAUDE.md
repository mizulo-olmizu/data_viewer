# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

JS/TS側にはlinterやテストスイートは設定されていない（eslint/prettier/vitestなし）。フロントエンドの型チェックは `npm run build` 内の `tsc` ステップのみ。

## アーキテクチャ

### 隠れたHTTPサーバーを持つ2プロセス構成

Rust側（`src-tauri/`）は単なるTauri IPCバックエンドではなく、起動時に **axumのHTTPサーバー**（デフォルトポート3000、`-p`で変更可）も同時に立ち上げ、`/update-data` と `/health-check` のルートを持つ。これにより、パッケージ化されたアプリをCLIから2回目以降に起動した場合（例: `dataviewer -i file.csv`）、新しいウィンドウを開く代わりに既存インスタンスへ引数を渡せるようになっている: `tauri-plugin-single-instance` がその再起動を横取りし、通常起動時と同じ方法でargvをパースし、`DbState::register_data` を呼び、フロントエンドに `update-data` というTauriイベントを発火する。macOSの「このアプリケーションで開く」によるファイル関連付けは別経路（`opened_event_listener`、`RunEvent::Opened`）を通る。この3つのエントリーポイント（`setup()` 内の起動時CLI引数、single-instance再起動、macOSのopen-with）はすべて最終的に同じ `register_data` → `update-data` イベント発火という流れに収束するので、ファイル読み込み周りの挙動を変更する際は `src-tauri/src/lib.rs` 内のこの3箇所すべてを確認すること。

### クレート分割: `data_viewer_lib` と `db`

- `src-tauri/db`（workspaceメンバー、クレート名 `db`）: DuckDB/Arrow関連のロジックをすべて持つ、フレームワーク非依存の層。`DbState` がDuckDBのコネクションをラップし、データに関するあらゆる処理を担う — `register_data`（ファイルをテーブルとして読み込む）、`execute`/`execute_with_save`、スキーマ取得、カラムごとの統計サマリー（`numeric_summarise`、`temporal_summarise`、`string_summarise`、`boolean_summarise`、`other_summarise`、`binning`、`value_counts`）など。カラムのdtypeマッピング/パースは `duckdb_data_type.rs` にある。
- `src-tauri/src`（クレート名 `data_viewer_lib`、Cargo workspaceのルートパッケージ）: Tauriとのつなぎ込み層。`src/modules/handler.rs` がフロントエンドから `invoke(...)` 経由で呼ばれる `#[tauri::command]` 関数群（`register_data`、`execute_query`、`extract_table`、`get_table_names`、`get_status`、`get_duckdb_symbols`、`sql_lint`、`sql_fix`）を公開しており、`DbState` を `AppData` でラップしてTauriのmanaged state内で `Mutex` 越しに保持している。
- `src/modules/handler/sqruff.rs`: `sqruff-lib` によるSQL linter/formatterをラップし、Monacoエディタのリアルタイム診断・保存時フォーマットに使われる `sql_lint`/`sql_fix` コマンドを提供する。

### フロントエンドのデータフロー

`src/handler.ts` がReactとRustの唯一の境界であり、すべての `invoke()` 呼び出しとそのレスポンス形式（`ExtractDataResult` → `ExtractDataResultConverted` へ変換、`dfJson` をJSONパースして `DataFrame` にする、など）はここに集約されている。`App.tsx` がトップレベルの状態（現在のテーブルデータ、テーブル名一覧、クエリ、ステータス）を保持し、バックエンドの `update-data` イベント（上記3つのエントリーポイントいずれかから発火される）を監視して新しいファイルが読み込まれたことを検知し、テーブル名と現在のテーブルデータを再取得する。カラム単位のチャート/サマリーコンポーネント（`src/charts/`）は、クライアント側で統計量を再計算するのではなく、Rust側のsummarise関数群が生成する `ColumnSummary` のバリアントをそのまま消費する。

### SQL編集まわり

Monacoの設定は `src/monacoLanguageConfig.ts` / `src/SQLEditor.tsx` にある。シンタックスハイライトと補完は静的なキーワードリストではなく、バックエンドから取得した `DuckdbSymbol`（`getDuckdbSymbols`、内部的には `DbState::get_duckdb_symbols`）を元にしているため、実際に使っているDuckDBのビルドと常に一致する。Lint/フォーマットは `sql_lint`/`sql_fix` を経由し、JS製のSQL linterではなくRust側の `sqruff-lib` を呼び出す形になっている。

## 設計ドキュメント

`docs/design/overview.md` に、実現したい機能一覧・各機能の実装状況（✅/🟡/⬜）・今後の実装ロードマップがまとまっている。機能追加や改善に着手する前にこのファイルを確認し、スコープと優先順位を把握すること。機能の実装が完了したら、該当行のステータスをそのPR内で更新すること（ドキュメントが実態と乖離しないようにするため）。

## その他

- `src-tauri/tauri.conf.json` にCLI引数（`-i/--input`、`-f/--file-type`、`-t/--separator`、`-n/--name`、`-s/--infer-schema-length`、`-p/--port`）とファイル関連付けが定義されている。引数を変更する場合は `src-tauri/src/lib.rs` の `MyArgs` と齟齬が出ないよう注意すること。
- クレート構成・エントリーポイント・データフローなど、上記「アーキテクチャ」節の内容に影響する変更をした場合は、同じPR内でこのファイルも更新すること。
