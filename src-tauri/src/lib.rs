use polars::prelude::*;
use tauri::{App, Manager, State};
use tauri_plugin_cli::CliExt;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str, state: State<'_, AppData>) -> String {
    format!(
        "Hello, {}! You've been greeted from Rust! Your file path is {:?}",
        name, state.data
    )
}

struct AppData {
    data: Option<DataFrame>,
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let args = app.cli().matches()?.args;

    let file_path = args
        .get("file_path")
        .and_then(|arg_data| arg_data.value.as_str());

    println!("{:?}", file_path);

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
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
