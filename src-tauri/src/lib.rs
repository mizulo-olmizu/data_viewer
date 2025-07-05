use crate::modules::handler::{extract_data, register_data, AppData};
use crate::modules::new_data_frame::{
    CsvOption, InferSchemaLength, InputTarget, JsonLineOption, JsonOption, NewDataFrame,
    ReadDataKind,
};
use anyhow::{anyhow, Result};
use axum::{
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{App, AppHandle, Emitter, Manager, Url};
use tauri_plugin_cli::{ArgData, CliExt};
use tauri_plugin_log::{Target, TargetKind};

mod modules;

const DEFAULT_PORT: u16 = 3000;

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
    #[arg(long, short = 'p')]
    port: Option<u16>,
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
            .try_into()?;

        let port = args
            .get("port")
            .and_then(|arg_data| arg_data.value.as_str())
            .map(|s| s.parse::<u16>())
            .transpose()?;

        Ok(MyArgs {
            input: input.map(String::from),
            file_type: file_type.map(String::from),
            separator,
            name: name.map(String::from),
            infer_schema_length,
            port,
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
        port: _,
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
            port: None,
            df,
        })
    } else {
        Ok(AppData::default())
    }
}

fn opened_event_listener(app_handle: &AppHandle, urls: Vec<Url>) -> Result<()> {
    log::debug!("Opened: {:?}", urls);
    if urls.len() == 1 && urls[0].scheme() == "file" {
        let file_path = urls[0].path();

        let data = NewDataFrame::read_data(ReadDataKind::from_path(
            PathBuf::from(file_path),
            None,
            InferSchemaLength::Default,
        ))?;

        // ここでもmanageを実行していないと、初回起動の際は、setupの前にイベントが発生しているのか、クラッシュしてしまう。
        app_handle.manage(Mutex::new(AppData::default()));

        let state = app_handle.state::<Mutex<AppData>>();
        let mut state = state.lock().unwrap();

        state.name = Some(file_path.to_owned());
        state.df = Some(data);

        app_handle.emit("update-state", ())?;
        Ok(())
    } else {
        Ok(())
    }
}

fn setup(app: &mut App) -> Result<()> {
    let args: MyArgs = app.cli().matches()?.args.try_into()?;
    let app_data = args_to_data(args, None)?;

    let state = app.state::<Mutex<AppData>>();
    let mut state = state.lock().unwrap();
    state.name = app_data.name;
    state.df = app_data.df;

    Ok(())
}

async fn server_setup(app_handle: AppHandle) -> Result<()> {
    let app_handle_clone = app_handle.clone();
    let args: MyArgs = app_handle.cli().matches()?.args.try_into()?;
    let port = args.port.unwrap_or(DEFAULT_PORT);

    let app = Router::new()
        .route("/health-check", get(health_check))
        .route("/update-data", post(update_data))
        .with_state(app_handle);

    let addr = format!("127.0.0.1:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    log::info!("server started on {}", addr);

    let state = app_handle_clone.state::<Mutex<AppData>>();
    //MutexGuardを保持したままawaitを呼び出さないよう、スコープを制限する
    {
        let mut state = state.lock().unwrap();
        state.port = Some(port);
    }
    app_handle_clone.emit("update-state", ()).unwrap();

    axum::serve(listener, app).await?;

    Err(anyhow::anyhow!("Server stopped."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data = Mutex::new(AppData::default());

    let app = tauri::Builder::default()
        .manage(app_data)
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
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
                    .and_then(|args| {
                        // あとからport番号を指定しても、無視する
                        if let Some(port) = args.port {
                            log::info!("Ignore port number: {}", port);
                        }
                        args_to_data(args, Some(PathBuf::from(cwd)))
                    })
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
                    log::error!("Error in single instance init: {}", err);
                    app_handle.emit("error", format!("{}", err)).unwrap();
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .invoke_handler(tauri::generate_handler![extract_data, register_data])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    let app_handle = app.handle().clone();

    tauri::async_runtime::spawn(async move {
        let app_handle_clone = app_handle.clone();
        if let Err(err) = server_setup(app_handle).await {
            log::error!("Server error: {}", err);
            let state = app_handle_clone.state::<Mutex<AppData>>();
            let mut state = state.lock().unwrap();
            state.port = None;
            app_handle_clone.emit("update-state", ()).unwrap();
        }
    });

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            log::debug!("Opened: {:?}", urls);
            let result = opened_event_listener(app_handle, urls);

            if let Err(err) = result {
                log::error!("Error in opened event: {}", err);
                // TODO: これだと最初のエラーメッセージはfrontend側でlistenされない。 stateに保持しておく必要がある。
                app_handle.emit("error", format!("{}", err)).unwrap();
            }
        }
    });
}

#[derive(Serialize, Deserialize)]
struct UpdateDataRequest {
    input: String,
    file_type: Option<String>,
    separator: Option<char>,
    name: Option<String>,
    infer_schema_length: Option<String>,
}

impl TryFrom<UpdateDataRequest> for MyArgs {
    type Error = anyhow::Error;

    fn try_from(request: UpdateDataRequest) -> std::result::Result<Self, anyhow::Error> {
        let infer_schema_length = request.infer_schema_length.as_deref().try_into()?;

        Ok(MyArgs {
            input: Some(request.input),
            file_type: request.file_type,
            separator: request.separator,
            name: request.name,
            infer_schema_length,
            port: None,
        })
    }
}

async fn health_check() -> StatusCode {
    StatusCode::OK
}

async fn update_data(
    axum::extract::State(app_handle): axum::extract::State<AppHandle>,
    Json(payload): Json<UpdateDataRequest>,
) -> impl IntoResponse {
    let args: Result<MyArgs, _> = payload.try_into();
    let data = args.and_then(|args| args_to_data(args, None));

    match data {
        Ok(data) => {
            let state = app_handle.state::<Mutex<AppData>>();
            let mut state = state.lock().unwrap();

            state.name = data.name;
            state.df = data.df;
            app_handle.emit("update-state", ()).unwrap();
            StatusCode::OK.into_response()
        }
        Err(e) => {
            let error_message = format!("Internal server error: {}", e);
            let _ = app_handle.emit("error", &error_message);

            (StatusCode::INTERNAL_SERVER_ERROR, error_message).into_response()
        }
    }
}
