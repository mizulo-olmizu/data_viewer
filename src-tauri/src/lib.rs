use polars::prelude::*;
use std::io::Cursor;
use tauri::{App, Manager, State};
use tauri_plugin_cli::CliExt;

#[tauri::command]
fn extract_data(state: State<'_, AppData>) -> String {
    let mut data = state
        .data
        .clone()
        .unwrap_or_else(|| DataFrame::new(vec![]).unwrap());

    let mut buffer = Cursor::new(Vec::new());

    JsonWriter::new(&mut buffer)
        .with_json_format(JsonFormat::Json)
        .finish(&mut data)
        .unwrap();

    String::from_utf8(buffer.into_inner()).unwrap()
}

struct AppData {
    data: Option<DataFrame>,
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let args = app.cli().matches()?.args;

    let file_path = args
        .get("file_path")
        .and_then(|arg_data| arg_data.value.as_str());

    let data = file_path
        .map(|file_path| {
            CsvReadOptions::default()
                .with_has_header(true)
                .try_into_reader_with_file_path(Some(file_path.into()))
                .and_then(|reader| reader.finish())
        })
        .transpose()?;

    app.manage(AppData { data });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .setup(|app| {
            if let Err(err) = setup(app) {
                eprintln!("Error setting up app: {}", err);
            };
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
