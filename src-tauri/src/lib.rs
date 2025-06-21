use crate::modules::handler::{extract_data, register_data, AppData};
use crate::modules::new_data_frame::{
    CsvOption, InferSchemaLength, InputTarget, JsonLineOption, JsonOption, NewDataFrame,
    ReadDataKind,
};
use anyhow::{anyhow, Result};
use clap::Parser;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{App, Emitter, Manager};
use tauri_plugin_cli::{ArgData, CliExt};
use tauri_plugin_log::{Target, TargetKind};

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
            .and_then(|arg_data| arg_data.value.as_str());

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

fn args_to_data(args: MyArgs, cwd: Option<PathBuf>) -> Result<AppData> {
    let MyArgs {
        input,
        file_type,
        separator,
        infer_schema_length,
        name,
    } = args;

    let target = input.as_ref().map(|s| {
        if s == "-" {
            InputTarget::StdIn
        } else {
            let path = PathBuf::from(s);
            if let (true, Some(cwd)) = (path.is_relative(), cwd) {
                InputTarget::FilePath(cwd.join(&path))
            } else {
                InputTarget::FilePath(path)
            }
        }
    });

    if let Some(target) = target {
        let kind = match (file_type.as_deref(), target) {
            (Some("csv"), target) => Ok(ReadDataKind::Csv(
                target,
                CsvOption {
                    separator,
                    infer_schema_length,
                },
            )),
            (Some("tsv"), target) => Ok(ReadDataKind::Csv(
                target,
                CsvOption {
                    separator: Some(separator.unwrap_or('\t')),
                    infer_schema_length,
                },
            )),
            (Some("json"), target) => Ok(ReadDataKind::Json(
                target,
                JsonOption {
                    infer_schema_length,
                },
            )),
            (Some("jsonl"), target) => Ok(ReadDataKind::JsonLine(
                target,
                JsonLineOption {
                    infer_schema_length,
                },
            )),
            (Some("parquet"), InputTarget::FilePath(file_path)) => {
                Ok(ReadDataKind::Parquet(file_path))
            }
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

        Ok(AppData {
            name: name.or(input),
            df,
        })
    } else {
        Ok(AppData::default())
    }
}

fn setup(app: &mut App) -> Result<()> {
    let args = app.cli().matches()?.args.try_into()?;
    let app_data = args_to_data(args, None)?;

    app.manage(Mutex::new(app_data));

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([Target::new(TargetKind::Stdout)])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            if let Err(err) = setup(app) {
                eprintln!("Error setting up app: {}", err);
                std::process::exit(1);
            };
            log::info!("app setup done!");
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(
            |app_handle, args, cwd| {
                let result = MyArgs::try_parse_from(&args)
                    .map_err(|e| anyhow!(e))
                    .and_then(|args| args_to_data(args, Some(PathBuf::from(cwd))))
                    .and_then(|app_data| {
                        let state = app_handle.state::<Mutex<AppData>>();
                        let mut state = state.lock().unwrap();

                        state.name = app_data.name;
                        state.df = app_data.df;

                        app_handle.emit("update-state", ())?;

                        Ok(())
                    })
                    .map(|_| {
                        // できたらフォーカスする。失敗してもエラーにはせず潰す。
                        let _ = app_handle
                            .get_webview_window("main")
                            .map(|window| window.set_focus());
                    });

                if let Err(err) = result {
                    eprintln!("Error setting up app: {}", err);
                    std::process::exit(1);
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .invoke_handler(tauri::generate_handler![extract_data, register_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
