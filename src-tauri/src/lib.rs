use crate::modules::handler::{extract_data, register_data, AppData};
use crate::modules::new_data_frame::{
    CsvOption, InferSchemaLength, InputTarget, JsonLineOption, JsonOption, NewDataFrame,
    ReadDataKind,
};
use anyhow::{anyhow, Result};
use clap::Parser;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{App, Manager};
use tauri_plugin_cli::{ArgData, CliExt};

mod modules;

#[derive(Parser)]
struct MyArgs {
    #[arg(long, short = 'i')]
    input: Option<String>,
    #[arg(long, short = 'f', value_parser = clap::builder::PossibleValuesParser::new(["csv", "tsv", "json", "jsonl", "parquet"]))]
    file_type: Option<String>,
    #[arg(long, short = 't')]
    separator: Option<char>,
    #[arg(long, short = 'n')]
    name: Option<String>,
    #[arg(long, short = 's', value_parser = |s: &str| {InferSchemaLength::try_from(Some(s))}, default_value_t = InferSchemaLength::Default)]
    infer_schema_length: InferSchemaLength,
}

impl TryFrom<HashMap<String, ArgData>> for MyArgs {
    type Error = anyhow::Error;

    fn try_from(args: HashMap<String, ArgData>) -> std::result::Result<Self, anyhow::Error> {
        let input = args
            .get("input")
            .and_then(|arg_data| arg_data.value.as_str());

        let name = args
            .get("name")
            .and_then(|arg_data| arg_data.value.as_str())
            .or(input);

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
                    Ok(InferSchemaLength::Inf)
                } else {
                    s.parse::<NonZeroUsize>().map(InferSchemaLength::Len)
                }
            })
            .transpose()?
            .unwrap_or(InferSchemaLength::Default);

        Ok(MyArgs {
            input: input.map(String::from),
            file_type: file_type.map(String::from),
            separator,
            name: name.map(String::from),
            infer_schema_length,
        })
    }
}

fn setup(app: &mut App, args: Option<MyArgs>) -> Result<()> {
    let MyArgs {
        input,
        file_type,
        separator,
        infer_schema_length,
        name,
    } = if let Some(args) = args {
        args
    } else {
        app.cli().matches()?.args.try_into()?
    };

    let target = input.as_ref().map(|s| {
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

    let kind = match (file_type.as_deref(), &target) {
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
            if let Err(err) = setup(app, None) {
                eprintln!("Error setting up app: {}", err);
                std::process::exit(1);
            };
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_data, register_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
