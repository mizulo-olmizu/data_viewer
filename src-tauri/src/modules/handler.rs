mod sqruff;

use anyhow::Result;
use db::{
    duckdb_data_type::DtypeGroup, escape_sql_identifier, ColumnSummary, DbState, DuckdbSymbol,
    ReadDataType, TableSummary,
};
use serde::{Deserialize, Serialize};
use sqruff::Diagnostic;
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;
use tauri::{ipc::InvokeError, ipc::Response, App, AppHandle, Emitter, Manager, State};

// UI(ログビューア)に保持するログの最大件数。超えた分は古いものから捨てる
// (無制限に溜め続けてメモリを圧迫しないようにするため)。
const MAX_LOG_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp_ms: u64,
    pub level: LogLevel,
    pub message: String,
    // perf計測ログ(app_log_perf経由)のみSome。所要時間での色分け・ソート等、
    // メッセージ文字列のパースに頼らずフロント側で扱えるようにするための構造化フィールド。
    pub duration_ms: Option<u64>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct AppData {
    pub dbstate: DbState,
    pub port: Option<u16>,
    pub last_backend_error: Option<String>,
    // アプリ全体の設定。フロントエンド(設定画面)が持つ形をそのままJSONとして保持する、
    // Rust側では中身を解釈しない不透明な値。Tauriのapp config dir配下にディスク永続化される
    // (get_settings/set_settingsコマンド経由)。唯一`focusOnExternalUpdate`フィールドだけは、
    // single-instance再起動/HTTPハンドラでのwindow.set_focus()呼び出しを制御するためRust側でも読む。
    pub settings: serde_json::Value,
    // ログビューア用のリングバッファ(#17の議論から派生したログ閲覧機能)。標準出力/ログファイル
    // (tauri_plugin_log)とは独立に、`app_log`経由で記録したものだけがここに入る。
    pub logs: VecDeque<LogEntry>,
}

impl AppData {
    pub fn try_new(db_path: Option<&str>) -> Result<Self> {
        let dbstate = DbState::try_new(db_path)?;

        Ok(AppData {
            dbstate,
            port: None,
            last_backend_error: None,
            settings: serde_json::json!({}),
            logs: VecDeque::new(),
        })
    }

    pub fn focus_on_external_update(&self) -> bool {
        self.settings
            .get("focusOnExternalUpdate")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    // 設定画面(settings.json)に永続化されたHTTPサーバーのポート番号。未設定/不正な値ならNone。
    pub fn configured_port(&self) -> Option<u16> {
        self.settings
            .get("httpPort")
            .and_then(|v| v.as_u64())
            .and_then(|v| u16::try_from(v).ok())
    }

    pub fn record_log(
        &mut self,
        level: LogLevel,
        message: String,
        duration_ms: Option<u64>,
    ) -> LogEntry {
        let entry = LogEntry {
            timestamp_ms: now_ms(),
            level,
            message,
            duration_ms,
        };
        self.logs.push_back(entry.clone());
        if self.logs.len() > MAX_LOG_ENTRIES {
            self.logs.pop_front();
        }
        entry
    }
}

fn app_log_impl(
    app_handle: &AppHandle,
    level: LogLevel,
    message: String,
    duration_ms: Option<u64>,
) {
    match level {
        LogLevel::Trace => log::trace!("{message}"),
        LogLevel::Debug => log::debug!("{message}"),
        LogLevel::Info => log::info!("{message}"),
        LogLevel::Warn => log::warn!("{message}"),
        LogLevel::Error => log::error!("{message}"),
    }

    let entry = {
        let state = app_handle.state::<Mutex<AppData>>();
        let mut state = state.lock().unwrap();
        state.record_log(level, message, duration_ms)
    };

    let _ = app_handle.emit("app-log", entry);
}

// 標準出力/ログファイル(`log`クレート経由、既存の`tauri_plugin_log`の設定に従う)への出力に加えて、
// ログビューア用のリングバッファへも記録し、開いていれば即時反映されるようイベントを発火する。
// 新しくログを仕込む場所では、生の`log::info!`等ではなくこちらを使う。
pub fn app_log(app_handle: &AppHandle, level: LogLevel, message: impl Into<String>) {
    app_log_impl(app_handle, level, message.into(), None);
}

// 処理時間の計測結果を記録する版のapp_log。メッセージ末尾に"(Nms)"を付与しつつ、
// duration_msにも構造化して記録する(LogViewer側でのBadge表示・閾値判定に使う)。
// パフォーマンス改善(docs/design/performance.md)の実測用に、既存のログ機構を拡張したもの。
pub fn app_log_perf(
    app_handle: &AppHandle,
    level: LogLevel,
    message: impl Into<String>,
    duration: std::time::Duration,
) {
    let duration_ms = duration.as_millis() as u64;
    let message = format!("{} ({duration_ms}ms)", message.into());
    app_log_impl(app_handle, level, message, Some(duration_ms));
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub db_path: Option<String>,
    pub port: Option<u16>,
    pub last_backend_error: Option<String>,
}

impl From<&AppData> for Status {
    fn from(app_data: &AppData) -> Self {
        let db_path = app_data.dbstate.db_path();

        Status {
            db_path,
            port: app_data.port,
            last_backend_error: app_data.last_backend_error.clone(),
        }
    }
}

const APP_SETTINGS_FILE_NAME: &str = "settings.json";

fn app_settings_path(app_handle: &AppHandle) -> Result<std::path::PathBuf> {
    Ok(app_handle.path().app_config_dir()?.join(APP_SETTINGS_FILE_NAME))
}

// 起動時に永続化済みの設定を読み込み、AppDataへ反映する。
// ファイルが無い/壊れている場合は空({})のまま無視する(初回起動時は常にこのパス)。
pub fn load_persisted_app_settings(app: &App, state: &mut AppData) {
    let Ok(path) = app_settings_path(app.app_handle()) else {
        return;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };
    state.settings = settings;
}

#[tauri::command]
pub async fn get_settings(
    state: State<'_, Mutex<AppData>>,
) -> Result<serde_json::Value, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    Ok(state.settings.clone())
}

#[tauri::command]
pub async fn set_settings(
    settings: serde_json::Value,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    // ここでの`httpPort`はあくまで次回起動時に使うデフォルト値の永続化であり、稼働中の
    // HTTPサーバーへは反映しない(現在稼働中のポートを変えたい場合は`switch_http_port`を使う)。
    {
        let mut state = state.lock().map_err(InvokeError::from_error)?;
        state.settings = settings.clone();
    }

    let path = app_settings_path(&app_handle).map_err(InvokeError::from_anyhow)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(InvokeError::from_error)?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(InvokeError::from_error)?;
    std::fs::write(&path, content).map_err(InvokeError::from_error)?;

    Ok(())
}

// 現在稼働中のHTTPサーバーのポートを直接切り替える(設定画面の`httpPort`とは独立)。
// サイドバーから、確認したうえで明示的に切り替えたい場合に呼ばれる。実際にbindが成功/失敗する
// まで待ってから返す(呼び出し元がその場でエラーを表示できるようにするため)。「既に同じポート
// かどうか」の事前チェックはここでは行わない(run_http_server側の権威あるチェックに一本化し、
// 切り替え処理の途中でstate.portの更新が遅延するタイミングとのTOCTOU競合を避けるため)。
#[tauri::command]
pub async fn switch_http_port(
    port: u16,
    port_switch: State<'_, crate::PortSwitch>,
) -> Result<(), InvokeError> {
    if port == 0 {
        return Err(InvokeError::from(
            "ポート番号には1以上の値を指定してください".to_string(),
        ));
    }

    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    port_switch
        .0
        .send(crate::PortSwitchRequest {
            port,
            reply: Some(reply_tx),
        })
        .map_err(|_| InvokeError::from("HTTPサーバーが応答していません".to_string()))?;

    match reply_rx.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(message)) => Err(InvokeError::from(message)),
        Err(_) => Err(InvokeError::from(
            "HTTPサーバーが応答していません".to_string(),
        )),
    }
}

#[tauri::command]
pub async fn register_data(
    file_path: &str,
    table_name: Option<&str>,
    data_type: Option<ReadDataType>,
    allow_replace: bool,
    options: HashMap<&str, &str>,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<String, InvokeError> {
    let start = std::time::Instant::now();
    let result: Result<String> = {
        let mut state = state.lock().map_err(InvokeError::from_error)?;
        state.dbstate.register_data(
            Path::new(file_path),
            table_name.map(escape_sql_identifier).as_deref(),
            data_type,
            allow_replace,
            options,
        )
    };
    let elapsed = start.elapsed();

    match &result {
        Ok(registered_name) => app_log_perf(
            &app_handle,
            LogLevel::Info,
            format!("register_data: {file_path} -> table '{registered_name}'"),
            elapsed,
        ),
        Err(err) => app_log(
            &app_handle,
            LogLevel::Warn,
            format!("register_data failed for {file_path}: {err}"),
        ),
    }

    result.map_err(InvokeError::from_anyhow)
}

// 戻り値は`tauri::ipc::Response`(生のJSON文字列をそのままレスポンスbodyにする)。
// 通常の`Result<T, InvokeError>`(Tはserde Serialize)だと、`build_table_metadata_json`が
// 組み立てたJSON文字列を1フィールドとして返す際にTauriがもう一段JSONエスケープしてしまい、
// 大きいテーブルほどこのエスケープ処理自体がコストになる(詳細はdocs/design/performance.md)。
// `Response`経由なら文字列をそのまま送るため、この二重エスケープが発生しない。
//
// メインテーブルの全行データ(df)はここでは返さない(サーバー側ページング化により、
// フロントは`fetch_table_page`でスクロール等に応じて分割取得する。詳細はCLAUDE.md参照)。
#[tauri::command]
pub async fn get_table_metadata(
    table_name: &str,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<Response, InvokeError> {
    let mut perf_log = PerfLog::new();
    let result = {
        let state = state.lock().map_err(InvokeError::from_error)?;
        build_table_metadata_json(&state.dbstate, table_name, &mut perf_log)
    };
    flush_perf_log(&app_handle, perf_log);

    result.map(Response::new).map_err(InvokeError::from_anyhow)
}

// サーバー側ページング化用。sort_column/where_sqlは未エスケープの生入力として受け取り、
// ここでescape_sql_identifier/エスケープを行ってからDbStateへ渡す(where_sqlはWHERE句の
// 中身の式全体であり、識別子エスケープの対象外。SQLエディタと同じ信頼境界でユーザー自身の
// 検索語・フィルタ条件から組み立てられる想定)。totalRowsはここでは返さない
// (スクロールのたびにCOUNTし直す無駄を避けるため、`count_table_rows`コマンドで
// ソート/フィルタ条件が変わったときにのみ別途取得する)。
#[tauri::command]
pub async fn fetch_table_page(
    table_name: &str,
    offset: i64,
    limit: i64,
    sort_column: Option<&str>,
    sort_desc: bool,
    where_sql: Option<&str>,
    state: State<'_, Mutex<AppData>>,
) -> Result<Response, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    let table_name_escaped = escape_sql_identifier(table_name);
    let sort_column_escaped = sort_column.map(escape_sql_identifier);
    let sort = sort_column_escaped
        .as_deref()
        .map(|col| (col, sort_desc));

    let (df_json, _) = state
        .dbstate
        .extract_table_page(&table_name_escaped, offset, limit, sort, where_sql)
        .map_err(InvokeError::from_anyhow)?;

    Ok(Response::new(df_json))
}

// セル範囲選択のコピー専用。column_namesは未エスケープのカラム名リストで、ここで
// escape_sql_identifierする。空配列なら全列(SELECT *)を対象にする。
// 引数がTauriコマンドとしてのIPCペイロード(フロントのfetchRangeForCopy呼び出し)に
// 1:1で対応しており、ここだけのために構造体でまとめる方がかえって回りくどいため許容する。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn fetch_row_range(
    table_name: &str,
    offset: i64,
    limit: i64,
    sort_column: Option<&str>,
    sort_desc: bool,
    where_sql: Option<&str>,
    column_names: Vec<String>,
    state: State<'_, Mutex<AppData>>,
) -> Result<Response, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    let table_name_escaped = escape_sql_identifier(table_name);
    let sort_column_escaped = sort_column.map(escape_sql_identifier);
    let sort = sort_column_escaped
        .as_deref()
        .map(|col| (col, sort_desc));
    let column_names_escaped: Vec<String> =
        column_names.iter().map(|c| escape_sql_identifier(c)).collect();

    let df_json = state
        .dbstate
        .fetch_row_range(
            &table_name_escaped,
            offset,
            limit,
            sort,
            where_sql,
            &column_names_escaped,
        )
        .map_err(InvokeError::from_anyhow)?;

    Ok(Response::new(df_json))
}

#[tauri::command]
pub async fn count_table_rows(
    table_name: &str,
    where_sql: Option<&str>,
    state: State<'_, Mutex<AppData>>,
) -> Result<usize, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    let table_name_escaped = escape_sql_identifier(table_name);
    state
        .dbstate
        .count_table_rows(&table_name_escaped, where_sql)
        .map_err(InvokeError::from_anyhow)
}

// CSV全件エクスポート。現在のソート/フィルタ条件に一致する全行をDuckDB側で直接
// dest_pathへ書き出す(JSにデータを一切渡さない)。
#[tauri::command]
pub async fn export_table_csv(
    table_name: &str,
    sort_column: Option<&str>,
    sort_desc: bool,
    where_sql: Option<&str>,
    dest_path: &str,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    let table_name_escaped = escape_sql_identifier(table_name);
    let sort_column_escaped = sort_column.map(escape_sql_identifier);
    let sort = sort_column_escaped
        .as_deref()
        .map(|col| (col, sort_desc));

    state
        .dbstate
        .export_table_to_csv(&table_name_escaped, sort, where_sql, dest_path)
        .map_err(InvokeError::from_anyhow)
}

const LAST_QUERY_TABLE_NAME: &str = "_last";

#[tauri::command]
pub async fn execute_query(
    sql: &str,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<Response, InvokeError> {
    app_log(&app_handle, LogLevel::Info, format!("execute_query: {sql}"));

    let mut perf_log = PerfLog::new();
    let result = {
        let state = state.lock().map_err(InvokeError::from_error)?;

        let save_start = std::time::Instant::now();
        let save_result = state.dbstate.execute_with_save(sql, LAST_QUERY_TABLE_NAME);
        perf_log.push((
            LogLevel::Debug,
            format!("perf: execute_with_save(sql_len={})", sql.len()),
            save_start.elapsed(),
        ));

        // SELECT文で結果が返ってくるか試してみる
        save_result
            .and_then(|_| {
                build_table_metadata_json(&state.dbstate, LAST_QUERY_TABLE_NAME, &mut perf_log)
                    .map(Some)
            })
            .or_else(|_| {
                // エラーになるようなら実行のみする
                state.dbstate.execute(sql).map(|_| None)
            })
    };
    flush_perf_log(&app_handle, perf_log);

    if let Err(err) = &result {
        app_log(
            &app_handle,
            LogLevel::Warn,
            format!("execute_query failed: {err}"),
        );
    }

    // 結果セットを持たないSQL(DDL/DML)の場合はNone。フロント側にはJSONの`null`として
    // 伝える(`Option<ExtractDataResult>`だった頃と同じセマンティクス)。
    result
        .map(|json| Response::new(json.unwrap_or_else(|| "null".to_string())))
        .map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn sql_lint(sql: &str) -> Result<Vec<Diagnostic>, InvokeError> {
    sqruff::lint(sql).map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn sql_fix(sql: &str) -> Result<String, InvokeError> {
    sqruff::fix(sql).map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn get_duckdb_symbols(
    state: State<'_, Mutex<AppData>>,
) -> Result<Vec<DuckdbSymbol>, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    state
        .dbstate
        .get_duckdb_symbols()
        .map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn get_table_names(state: State<'_, Mutex<AppData>>) -> Result<Vec<String>, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    state
        .dbstate
        .get_table_names()
        .map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn get_status(state: State<'_, Mutex<AppData>>) -> Result<Status, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    Ok((&*state).into())
}

#[tauri::command]
pub async fn get_logs(state: State<'_, Mutex<AppData>>) -> Result<Vec<LogEntry>, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    Ok(state.logs.iter().cloned().collect())
}

// フロントエンド側(invoke呼び出し・JSON.parse等)の処理時間をログビューアに記録するための窓口。
// パフォーマンス改善(docs/design/performance.md)の実測用。フロント側では計測自体のレイテンシが
// 本処理に乗らないよう、この呼び出しはfire-and-forgetで行う想定。
#[tauri::command]
pub async fn log_frontend_perf(
    label: &str,
    duration_ms: u64,
    app_handle: AppHandle,
) -> Result<(), InvokeError> {
    app_log_perf(
        &app_handle,
        LogLevel::Debug,
        format!("perf: frontend {label}"),
        std::time::Duration::from_millis(duration_ms),
    );
    Ok(())
}

// フロントエンドでエラーダイアログが閉じられたときに呼ばれる。last_backend_errorを
// 明示的にクリアすることで、以後の(この操作とは無関係な)update-status発火で同じ
// エラーが再表示されるのを防ぐ(#17)。
#[tauri::command]
pub async fn dismiss_backend_error(state: State<'_, Mutex<AppData>>) -> Result<(), InvokeError> {
    let mut state = state.lock().map_err(InvokeError::from_error)?;
    state.last_backend_error = None;
    Ok(())
}

#[tauri::command]
pub async fn save_text_file(path: &str, content: &str) -> Result<(), InvokeError> {
    std::fs::write(path, content).map_err(InvokeError::from_error)
}

#[tauri::command]
pub async fn save_database(
    path: &str,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let result: Result<()> = {
        let state = state.lock().map_err(InvokeError::from_error)?;
        state.dbstate.save_database(Path::new(path))
    };

    match &result {
        Ok(()) => app_log(&app_handle, LogLevel::Info, format!("save_database: {path}")),
        Err(err) => app_log(
            &app_handle,
            LogLevel::Warn,
            format!("save_database failed for {path}: {err}"),
        ),
    }

    result.map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn open_database(
    path: &str,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let dbstate = match DbState::try_new(Some(path)) {
        Ok(dbstate) => dbstate,
        Err(err) => {
            app_log(
                &app_handle,
                LogLevel::Warn,
                format!("open_database failed for {path}: {err}"),
            );
            return Err(InvokeError::from_anyhow(err));
        }
    };

    {
        let mut state = state.lock().map_err(InvokeError::from_error)?;
        state.dbstate = dbstate;
    }

    app_log(&app_handle, LogLevel::Info, format!("open_database: {path}"));

    Ok(())
}

#[tauri::command]
pub async fn drop_table(
    table_name: &str,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let result: Result<()> = {
        let state = state.lock().map_err(InvokeError::from_error)?;
        state.dbstate.drop_table(table_name)
    };

    match &result {
        Ok(()) => app_log(
            &app_handle,
            LogLevel::Info,
            format!("drop_table: '{table_name}'"),
        ),
        Err(err) => app_log(
            &app_handle,
            LogLevel::Warn,
            format!("drop_table failed for '{table_name}': {err}"),
        ),
    }

    result.map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn rename_table(
    old_name: &str,
    new_name: &str,
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let result: Result<()> = {
        let state = state.lock().map_err(InvokeError::from_error)?;
        state.dbstate.rename_table(old_name, new_name)
    };

    match &result {
        Ok(()) => app_log(
            &app_handle,
            LogLevel::Info,
            format!("rename_table: '{old_name}' -> '{new_name}'"),
        ),
        Err(err) => app_log(
            &app_handle,
            LogLevel::Warn,
            format!("rename_table failed ('{old_name}' -> '{new_name}'): {err}"),
        ),
    }

    result.map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn new_in_memory_database(
    app_handle: AppHandle,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let dbstate = DbState::try_new(None).map_err(InvokeError::from_anyhow)?;

    {
        let mut state = state.lock().map_err(InvokeError::from_error)?;
        state.dbstate = dbstate;
    }

    app_log(&app_handle, LogLevel::Info, "new_in_memory_database");

    Ok(())
}

// (level, message, duration_ms)のバッファ。build_table_metadata_json実行中はAppDataのMutexを
// 保持したままなので、その場でapp_log_perfを呼ぶとAppData.logsへの書き込みで同じMutexを
// 再度lockしようとして自己デッドロックする(std::sync::Mutexは再入不可)。そのため計測結果は
// 一旦ここに溜め、呼び出し元(get_table_metadata/execute_queryコマンド)がロックを解放した後に
// flush_perf_logでまとめて出力する。
pub type PerfLog = Vec<(LogLevel, String, std::time::Duration)>;

pub fn flush_perf_log(app_handle: &AppHandle, perf_log: PerfLog) {
    for (level, message, duration) in perf_log {
        app_log_perf(app_handle, level, message, duration);
    }
}

// フロントへ返す最終的なJSONオブジェクトテキストをそのまま組み立てて返す
// (`{"name":...,"schema":...,"summary":...,"totalRows":...}`)。メインテーブルの全行データ
// (df)はここには含めない(サーバー側ページング化により、フロントは`fetch_table_page`で
// 別途分割取得する)。呼び出し元(get_table_metadata/execute_queryコマンド)はこの文字列を
// `tauri::ipc::Response`でそのまま返すことで、Tauri側の追加のJSONエスケープを避ける
// (詳細はdocs/design/performance.md参照)。
pub fn build_table_metadata_json(
    dbstate: &DbState,
    table_name: &str,
    perf_log: &mut PerfLog,
) -> Result<String> {
    let total_start = std::time::Instant::now();
    let table_name_escaped = escape_sql_identifier(table_name);

    let count_start = std::time::Instant::now();
    let total_rows = dbstate.count_table_rows(&table_name_escaped, None)?;
    perf_log.push((
        LogLevel::Debug,
        format!("perf: count_table_rows(table={table_name}, rows={total_rows})"),
        count_start.elapsed(),
    ));

    let schema = dbstate.get_columns_schema(table_name)?;

    let summary: TableSummary = schema
        .iter()
        .map(|info| {
            let column_name_escaped = escape_sql_identifier(&info.column_name);
            let dtype_group = DtypeGroup::from(info.column_type.clone());
            let summarise_start = std::time::Instant::now();

            let result = match &dtype_group {
                DtypeGroup::Numeric => dbstate
                    .numeric_summarise(&table_name_escaped, &column_name_escaped)
                    .map(|summary| ColumnSummary::Numeric {
                        column_name: info.column_name.clone(),
                        summary,
                    }),
                DtypeGroup::Temporal => dbstate
                    .temporal_summarise(&table_name_escaped, &column_name_escaped)
                    .map(|summary| ColumnSummary::Temporal {
                        column_name: info.column_name.clone(),
                        summary,
                    }),
                DtypeGroup::String => dbstate
                    .string_summarise(&table_name_escaped, &column_name_escaped)
                    .map(|summary| ColumnSummary::String {
                        column_name: info.column_name.clone(),
                        summary,
                    }),
                DtypeGroup::Boolean => dbstate
                    .boolean_summarise(&table_name_escaped, &column_name_escaped)
                    .map(|summary| ColumnSummary::Boolean {
                        column_name: info.column_name.clone(),
                        summary,
                    }),
                _ => dbstate
                    .other_summarise(&table_name_escaped, &column_name_escaped)
                    .map(|summary| ColumnSummary::Other {
                        column_name: info.column_name.clone(),
                        summary,
                    }),
            };

            perf_log.push((
                LogLevel::Debug,
                format!(
                    "perf: summarise(table={table_name}, column={}, type={dtype_group:?})",
                    info.column_name
                ),
                summarise_start.elapsed(),
            ));

            result
        })
        .collect::<Result<TableSummary>>()?;

    perf_log.push((
        LogLevel::Info,
        format!(
            "perf: build_table_metadata_json(table={table_name}) total, columns={}",
            schema.len()
        ),
        total_start.elapsed(),
    ));

    let name_json = serde_json::to_string(table_name)?;
    let schema_json = serde_json::to_string(&schema)?;
    let summary_json = serde_json::to_string(&summary)?;

    Ok(format!(
        r#"{{"name":{name_json},"schema":{schema_json},"summary":{summary_json},"totalRows":{total_rows}}}"#
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_save_text_file_writes_content() {
        let path = std::env::temp_dir().join(format!(
            "dataviewer_test_save_text_file_{}.txt",
            std::process::id()
        ));
        let path_str = path.to_str().unwrap();

        save_text_file(path_str, "hello").await.unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn build_table_metadata_json_returns_valid_json_with_expected_fields() {
        let sample_csv = Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/db/tests/fixtures/sample.csv"
        ));

        let mut dbstate = DbState::try_new(None).unwrap();
        dbstate
            .register_data(sample_csv, None, None, false, HashMap::new())
            .unwrap();

        let mut perf_log = PerfLog::new();
        let json_text =
            build_table_metadata_json(&dbstate, "sample", &mut perf_log).unwrap();

        // 手組みで連結しているJSONテキスト(カンマ抜け・波括弧ミスマッチ等)が
        // 実際に妥当なJSONとしてパースでき、期待するフィールドを持つことを検証する。
        let parsed: serde_json::Value = serde_json::from_str(&json_text).unwrap();
        let obj = parsed.as_object().unwrap();
        assert_eq!(obj.get("name").unwrap().as_str().unwrap(), "sample");
        assert!(obj.get("schema").unwrap().is_array());
        assert!(obj.get("summary").unwrap().is_array());
        assert!(obj.get("totalRows").unwrap().is_u64());
    }

    #[test]
    fn configured_port_reads_http_port_from_settings() {
        let mut app_data = AppData::try_new(None).unwrap();

        // settingsが空(未保存)の場合はNone
        assert_eq!(app_data.configured_port(), None);

        app_data.settings = serde_json::json!({ "httpPort": 4000 });
        assert_eq!(app_data.configured_port(), Some(4000));

        // u16の範囲外の値は無視してNoneを返す(不正な値でクラッシュしない)
        app_data.settings = serde_json::json!({ "httpPort": 70000 });
        assert_eq!(app_data.configured_port(), None);

        // 数値以外の値も無視してNoneを返す
        app_data.settings = serde_json::json!({ "httpPort": "3000" });
        assert_eq!(app_data.configured_port(), None);
    }
}
