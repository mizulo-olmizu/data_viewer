use anyhow::Result;
use db::{
    duckdb_data_type::DtypeGroup, escape_sql_identifier, ColumnSummary, DbState, ExtractDataResult,
    ReadDataType, TableSummary,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{ipc::InvokeError, State};

pub struct AppData {
    pub dbstate: DbState,
}

impl AppData {
    pub fn try_new(db_path: Option<&str>) -> Result<Self> {
        let dbstate = DbState::try_new(db_path)?;

        Ok(AppData { dbstate })
    }
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub port: Option<u16>,
    pub last_backend_error: Option<String>,
}

#[tauri::command]
pub async fn register_data(
    file_path: &str,
    table_name: &str,
    data_type: ReadDataType,
    allow_replace: bool,
    options: HashMap<&str, &str>,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let mut state = state.lock().map_err(InvokeError::from_error)?;

    state
        .dbstate
        .register_data(
            Path::new(file_path),
            &escape_sql_identifier(table_name),
            data_type,
            allow_replace,
            options,
        )
        .map_err(InvokeError::from_anyhow)?;

    Ok(())
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
pub async fn get_table_names(state: State<'_, Mutex<AppData>>) -> Result<Vec<String>, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    state
        .dbstate
        .get_table_names()
        .map_err(InvokeError::from_anyhow)
}

#[tauri::command]
pub async fn get_status(state: State<'_, Mutex<AppStatus>>) -> Result<AppStatus, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;
    Ok(state.clone())
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
