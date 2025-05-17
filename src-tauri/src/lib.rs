use polars::prelude::*;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::Mutex;
use tauri::{App, Manager, State};
use tauri_plugin_cli::CliExt;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
struct ExtractDataResult {
    file_path: String,
    df: String,
}

#[tauri::command]
fn extract_data(state: State<'_, Mutex<AppData>>) -> ExtractDataResult {
    let state = state.lock().unwrap();

    let file_path = state.file_path.clone();

    let mut data = state
        .df
        .clone()
        .unwrap_or_else(|| DataFrame::new(vec![]).unwrap());

    let mut buffer = Cursor::new(Vec::new());

    JsonWriter::new(&mut buffer)
        .with_json_format(JsonFormat::Json)
        .finish(&mut data)
        .unwrap();

    ExtractDataResult {
        file_path: file_path.unwrap_or_else(|| String::from("")),
        df: String::from_utf8(buffer.into_inner()).unwrap(),
    }
}

#[tauri::command]
fn register_data(file_path: &str, state: State<'_, Mutex<AppData>>) -> Result<(), String> {
    let data = CsvReadOptions::default()
        .with_has_header(true)
        .try_into_reader_with_file_path(Some(file_path.into()))
        .and_then(|reader| reader.finish())
        .map_err(|_| "register data error!".to_owned())?;

    let mut state = state.lock().unwrap();
    state.file_path = Some(file_path.to_owned());
    state.df = Some(data);
    Ok(())
}

struct AppData {
    file_path: Option<String>,
    df: Option<DataFrame>,
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let args = app.cli().matches()?.args;

    let file_path = args
        .get("file_path")
        .and_then(|arg_data| arg_data.value.as_str());

    let df = file_path
        .map(|file_path| {
            CsvReadOptions::default()
                .with_has_header(true)
                .try_into_reader_with_file_path(Some(file_path.into()))
                .and_then(|reader| reader.finish())
        })
        .transpose()?;

    app.manage(Mutex::new(AppData {
        file_path: file_path.map(|s| s.to_owned()),
        df,
    }));

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .setup(|app| {
            if let Err(err) = setup(app) {
                eprintln!("Error setting up app: {}", err);
            };
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_data, register_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
