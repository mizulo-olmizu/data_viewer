use polars::prelude::*;
use tauri::{Manager, State};
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
    data: DataFrame,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .setup(|app| {
            let file_path = match app.cli().matches() {
                // `matches` here is a Struct with { args, subcommand }.
                // `args` is `HashMap<String, ArgData>` where `ArgData` is a struct with { value, occurrences }.
                // `subcommand` is `Option<Box<SubcommandMatches>>` where `SubcommandMatches` is a struct with { name, matches }.
                Ok(matches) => matches
                    .args
                    .get("file_path")
                    .map(|arg_data| arg_data.value.clone()),
                Err(_) => None,
            }
            .unwrap()
            .as_str()
            .map(|s| s.to_owned())
            .unwrap();

            println!("{}", file_path);

            let data = CsvReadOptions::default()
                .with_has_header(true)
                .try_into_reader_with_file_path(Some(file_path.into()))
                .unwrap()
                .finish()
                .unwrap();

            app.manage(AppData { data });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
