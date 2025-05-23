use crate::modules::handler::{extract_data, register_data, AppData};
use anyhow::Result;
use polars::prelude::*;
use std::io::{self, Cursor, Read};
use std::sync::Mutex;
use tauri::{App, Manager};
use tauri_plugin_cli::CliExt;

mod modules;

fn setup(app: &mut App) -> Result<()> {
    let args = app.cli().matches()?.args;

    let input = args
        .get("input")
        .and_then(|arg_data| arg_data.value.as_str());

    let df = input
        .map(|input| {
            if input == "-" {
                let mut input_data = String::new();
                io::stdin().lock().read_to_string(&mut input_data)?;
                let cursor = Cursor::new(input_data);

                CsvReadOptions::default()
                    .with_has_header(true)
                    .into_reader_with_file_handle(cursor)
                    .finish()
            } else {
                CsvReadOptions::default()
                    .with_has_header(true)
                    .try_into_reader_with_file_path(Some(input.into()))
                    .and_then(|reader| reader.finish())
            }
        })
        .transpose()?
        .map(|df| df.into());

    app.manage(Mutex::new(AppData {
        file_path: input.map(|s| s.to_owned()),
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
