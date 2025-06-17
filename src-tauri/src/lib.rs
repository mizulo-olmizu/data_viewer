use crate::modules::handler::{extract_data, register_data, AppData};
use crate::modules::new_data_frame::{
    CsvOption, InferSchemaLength, InputTarget, JsonLineOption, JsonOption, NewDataFrame,
    ReadDataKind,
};
use anyhow::{anyhow, Result};
use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{App, Manager};
use tauri_plugin_cli::CliExt;

mod modules;

fn setup(app: &mut App) -> Result<()> {
    let args = app.cli().matches()?.args;

    let input = args
        .get("input")
        .and_then(|arg_data| arg_data.value.as_str());

    let name = args
        .get("name")
        .and_then(|arg_data| arg_data.value.as_str())
        .or(input)
        .map(|s| s.to_owned());

    let target = input.map(|s| {
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

    let infer_schema_length = args
        .get("infer-schema-length")
        .and_then(|arg_data| arg_data.value.as_str())
        .map(|s| {
            if s.to_lowercase() == "inf" {
                InferSchemaLength::Inf
            } else {
                let try_parsed = s.parse::<NonZeroUsize>();
                if let Ok(i) = try_parsed {
                    InferSchemaLength::Len(i)
                } else {
                    eprintln!(
                        "Invalid value for infer-schema-length: '{}'. Using default value of 100.",
                        s
                    );
                    InferSchemaLength::Default
                }
            }
        })
        .unwrap_or(InferSchemaLength::Default);

    let kind = match (file_type, &target) {
        (Some("csv"), _) => Ok(ReadDataKind::Csv(
            target,
            CsvOption {
                separator,
                infer_schema_length,
            },
        )),
        (Some("tsv"), _) => Ok(ReadDataKind::Csv(
            target,
            CsvOption {
                separator: Some(separator.unwrap_or('\t')),
                infer_schema_length,
            },
        )),
        (Some("json"), _) => Ok(ReadDataKind::Json(
            target,
            JsonOption {
                infer_schema_length,
            },
        )),
        (Some("jsonl"), _) => Ok(ReadDataKind::JsonLine(
            target,
            JsonLineOption {
                infer_schema_length,
            },
        )),
        (Some("parquet"), InputTarget::FilePath(file_path)) => Ok(ReadDataKind::Parquet(file_path)),
        (Some("parquet"), InputTarget::StdIn) => {
            Err(anyhow!("Parquet format does not support stdin."))
        }
        (_, InputTarget::FilePath(file_path)) => Ok(ReadDataKind::from_path(
            file_path,
            separator,
            infer_schema_length,
        )),
        (_, InputTarget::StdIn) => Ok(ReadDataKind::Csv(
            InputTarget::StdIn,
            CsvOption {
                separator,
                infer_schema_length,
            },
        )),
    }?;

    let df = Some(NewDataFrame::read_data(kind)?);

    app.manage(Mutex::new(AppData { name, df }));

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
                std::process::exit(1);
            };
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_data, register_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
