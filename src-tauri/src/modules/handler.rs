use crate::modules::new_data_frame::{InferSchemaLength, Schema, Summary};
use crate::modules::new_data_frame::{NewDataFrame, ReadDataKind};
use polars::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{ipc::InvokeError, State};

#[derive(Default)]
pub struct AppData {
    pub name: Option<String>,
    pub df: Option<NewDataFrame>,
}

#[tauri::command]
pub async fn register_data(
    file_path: &str,
    state: State<'_, Mutex<AppData>>,
) -> Result<(), InvokeError> {
    let mut state = state.lock().map_err(InvokeError::from_error)?;
    let data = NewDataFrame::read_data(ReadDataKind::from_path(
        PathBuf::from(file_path),
        None,
        InferSchemaLength::Default,
    ))
    .map_err(InvokeError::from_anyhow)?;

    state.name = Some(file_path.to_owned());
    state.df = Some(data);
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtractDataResult {
    pub name: String,
    pub df_json: String,
    pub schema: Schema,
    pub summary: Vec<Summary>,
}

#[tauri::command]
pub async fn extract_data(
    query: Option<&str>,
    state: State<'_, Mutex<AppData>>,
) -> Result<ExtractDataResult, InvokeError> {
    let state = state.lock().map_err(InvokeError::from_error)?;

    let name = state.name.clone();

    let df_origin = state
        .df
        .clone()
        .unwrap_or_else(|| DataFrame::new(vec![]).unwrap().into());

    let schema = df_origin.get_schema();

    let df = if let Some(query) = query {
        df_origin
            .execute_query(query)
            .map_err(InvokeError::from_anyhow)?
    } else {
        df_origin
    };

    let summary = df.summarize();

    Ok(ExtractDataResult {
        name: name.unwrap_or_else(|| String::from("")),
        df_json: df
            .time_to_str()
            .map_err(InvokeError::from_anyhow)?
            .get_json()
            .map_err(InvokeError::from_anyhow)?,
        schema,
        summary,
    })
}
