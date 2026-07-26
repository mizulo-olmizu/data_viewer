mod sqruff;

use anyhow::Result;
use db::{
    duckdb_data_type::DtypeGroup, escape_sql_identifier, ColumnSummary, DbState, DuckdbSymbol,
    ExtractDataResult, ReadDataType, TableSummary,
};
use serde::{Deserialize, Serialize};
use sqruff::Diagnostic;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{ipc::InvokeError, App, AppHandle, Manager, State};

pub struct AppData {
    pub dbstate: DbState,
    pub port: Option<u16>,
    pub last_backend_error: Option<String>,
    // アプリ全体の設定。フロントエンド(設定画面)が持つ形をそのままJSONとして保持する、
    // Rust側では中身を解釈しない不透明な値。Tauriのapp config dir配下にディスク永続化される
    // (get_settings/set_settingsコマンド経由)。唯一`focusOnExternalUpdate`フィールドだけは、
    // single-instance再起動/HTTPハンドラでのwindow.set_focus()呼び出しを制御するためRust側でも読む。
    pub settings: serde_json::Value,
}

impl AppData {
    pub fn try_new(db_path: Option<&str>) -> Result<Self> {
        let dbstate = DbState::try_new(db_path)?;

        Ok(AppData {
            dbstate,
            port: None,
            last_backend_error: None,
            settings: serde_json::json!({}),
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
// まで待ってから返す(呼び出し元がその場でエラーを表示できるようにするため)。
#[tauri::command]
pub async fn switch_http_port(
    port: u16,
    state: State<'_, Mutex<AppData>>,
    port_switch: State<'_, crate::PortSwitch>,
) -> Result<(), InvokeError> {
    let current_port = {
        let state = state.lock().map_err(InvokeError::from_error)?;
        state.port
    };

    if Some(port) == current_port {
        return Ok(());
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
    state: State<'_, Mutex<AppData>>,
) -> Result<String, InvokeError> {
    let mut state = state.lock().map_err(InvokeError::from_error)?;

    state
        .dbstate
        .register_data(
            Path::new(file_path),
            table_name.map(escape_sql_identifier).as_deref(),
            data_type,
            allow_replace,
            options,
        )
        .map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn extract_table(
    table_name: &str,
    state: State<'_, Mutex<AppData>>,
) -> Result<ExtractDataResult, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    extract_data(&state.dbstate, table_name).map_err(InvokeError::from_anyhow)
}

const LAST_QUERY_TABLE_NAME: &str = "_last";

#[tauri::command]
pub async fn execute_query(
    sql: &str,
    state: State<'_, Mutex<AppData>>,
) -> Result<Option<ExtractDataResult>, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    // SELECT文で結果が返ってくるか試してみる
    state
        .dbstate
        .execute_with_save(sql, LAST_QUERY_TABLE_NAME)
        .and_then(|_| extract_data(&state.dbstate, LAST_QUERY_TABLE_NAME).map(Some))
        .or_else(|_| {
            // エラーになるようなら実行のみする
            state.dbstate.execute(sql).map(|_| None)
        })
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
pub async fn save_text_file(path: &str, content: &str) -> Result<(), InvokeError> {
    std::fs::write(path, content).map_err(InvokeError::from_error)
}

#[tauri::command]
pub async fn save_database(path: &str, state: State<'_, Mutex<AppData>>) -> Result<(), InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    state
        .dbstate
        .save_database(Path::new(path))
        .map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn open_database(path: &str, state: State<'_, Mutex<AppData>>) -> Result<(), InvokeError> {
    let mut state = state.lock().map_err(InvokeError::from_error)?;

    let dbstate = DbState::try_new(Some(path)).map_err(InvokeError::from_anyhow)?;
    state.dbstate = dbstate;

    Ok(())
}

#[tauri::command]
pub async fn new_in_memory_database(state: State<'_, Mutex<AppData>>) -> Result<(), InvokeError> {
    let mut state = state.lock().map_err(InvokeError::from_error)?;

    let dbstate = DbState::try_new(None).map_err(InvokeError::from_anyhow)?;
    state.dbstate = dbstate;

    Ok(())
}

pub fn extract_data(dbstate: &DbState, table_name: &str) -> Result<ExtractDataResult> {
    let table_name_escaped = escape_sql_identifier(table_name);

    let df = dbstate.extract_table(&table_name_escaped)?;
    let df_json = serde_json::to_string(&df)?;
    let schema = dbstate.get_columns_schema(table_name)?;

    let summary: TableSummary = schema
        .iter()
        .map(|info| {
            let column_name_escaped = escape_sql_identifier(&info.column_name);

            match DtypeGroup::from(info.column_type.clone()) {
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
            }
        })
        .collect::<Result<TableSummary>>()?;

    Ok(ExtractDataResult {
        name: table_name.to_string(),
        df_json,
        schema,
        summary,
    })
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
}
