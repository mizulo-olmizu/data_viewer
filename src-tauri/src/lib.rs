use crate::modules::handler::{extract_data, register_data, AppData};
use crate::modules::new_data_frame::{CsvOption, InputTarget, NewDataFrame, ReadDataKind};
use anyhow::{anyhow, Result};
use std::path::Path;
use std::sync::Mutex;
use tauri::{App, Manager};
use tauri_plugin_cli::CliExt;

mod modules;

fn setup(app: &mut App) -> Result<()> {
    let args = app.cli().matches()?.args;

    let file_path = args
        .get("input")
        .and_then(|arg_data| arg_data.value.as_str());

    let target = file_path.map(|s| {
        if s == "-" {
            InputTarget::StdIn
        } else {
            InputTarget::FilePath(Path::new(s))
        }
    });

    if target.is_none() {
        app.manage(Mutex::new(AppData::default()));
        return Ok(());
    }

    let target = target.unwrap();

    let file_type = args
        .get("file-type")
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
        .transpose()?;

    let kind = match (file_type, &target) {
        (Some("csv"), _) => Ok(ReadDataKind::Csv(target, CsvOption { separator })),
        (Some("tsv"), _) => Ok(ReadDataKind::Csv(
            target,
            CsvOption {
                separator: Some(separator.unwrap_or('\t')),
            },
        )),
        (Some("json"), _) => Ok(ReadDataKind::Json(target)),
        (Some("jsonl"), _) => Ok(ReadDataKind::JsonLine(target)),
        (Some("parquet"), InputTarget::FilePath(file_path)) => Ok(ReadDataKind::Parquet(file_path)),
        (Some("parquet"), InputTarget::StdIn) => {
            Err(anyhow!("Parquet format does not support stdin."))
        }
        (_, InputTarget::FilePath(file_path)) => Ok(ReadDataKind::from_path(file_path, separator)),
        (_, InputTarget::StdIn) => Ok(ReadDataKind::Csv(
            InputTarget::StdIn,
            CsvOption { separator },
        )),
    }?;

    let df = NewDataFrame::read_data(kind)?;

    app.manage(Mutex::new(AppData {
        file_path: file_path.map(|s| s.to_owned()),
        df: Some(df),
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
