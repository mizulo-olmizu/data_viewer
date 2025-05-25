use crate::modules::handler::{extract_data, register_data, AppData};
use crate::modules::new_data_frame::{CsvOption, InputTarget, NewDataFrame, ReadDataKind};
use anyhow::{anyhow, Result};
use std::sync::Mutex;
use tauri::{App, Manager};
use tauri_plugin_cli::CliExt;

mod modules;

fn setup(app: &mut App) -> Result<()> {
    let args = app.cli().matches()?.args;

    let input = args
        .get("input")
        .and_then(|arg_data| arg_data.value.as_str());

    let separator = args
        .get("separator")
        .and_then(|arg_data| arg_data.value.as_str())
        .map(|s| {
            if s.chars().count() == 1 {
                Ok(s.chars().next().unwrap())
            } else {
                Err(anyhow!("Separator must be a single character."))
            }
        })
        .transpose()?
        .unwrap_or(',');

    let df = input
        .map(|input| {
            if input == "-" {
                NewDataFrame::read_data(ReadDataKind::Csv(CsvOption {
                    separator,
                    target: InputTarget::StdIn,
                }))
            } else {
                NewDataFrame::read_data(ReadDataKind::Csv(CsvOption {
                    separator,
                    target: InputTarget::FilePath(input.into()),
                }))
            }
        })
        .transpose()?;

    app.manage(Mutex::new(AppData {
        file_path: input.map(|s| s.to_owned()),
        df,
        separator,
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
