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
        .transpose()?
        .unwrap_or(',');

    let kind = match (file_type, target.clone()) {
        (Some("csv"), _) => ReadDataKind::Csv(CsvOption { separator, target }),
        (Some("json"), _) => ReadDataKind::Json(target),
        (Some("jsonl"), _) => ReadDataKind::JsonLine(target),
        (Some("parquet"), _) => ReadDataKind::Parquet(target),
        (_, InputTarget::FilePath(file_path)) => {
            let extension = file_path.extension().and_then(|s| s.to_str());
            match extension {
                Some("json") => ReadDataKind::Json(target),
                Some("jsonl") => ReadDataKind::JsonLine(target),
                Some("parquet") => ReadDataKind::Parquet(target),
                _ => ReadDataKind::Csv(CsvOption { separator, target }),
            }
        }
        _ => ReadDataKind::Csv(CsvOption { separator, target }),
    };

    let df = NewDataFrame::read_data(kind)?;

    app.manage(Mutex::new(AppData {
        file_path: file_path.map(|s| s.to_owned()),
        df: Some(df),
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
