use crate::modules::handler::{
    execute_query, extract_table, get_status, get_table_names, register_data, AppData,
};
use anyhow::{anyhow, ensure, Result};
use axum::{
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use db::ReadDataType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{App, AppHandle, Emitter, Manager, Url};
use tauri_plugin_cli::{ArgData, CliExt};
use tauri_plugin_log::{Target, TargetKind};

mod modules;

const DEFAULT_PORT: u16 = 3000;

#[derive(Debug, PartialEq, Clone, Default)]
pub enum InferSchemaLength {
    Len(NonZeroUsize),
    Inf,
    #[default]
    Default,
}

const DEFAULT_INITIAL_SCHEMA_LENGTH: NonZeroUsize = std::num::NonZeroUsize::new(100).unwrap();

impl From<InferSchemaLength> for Option<NonZeroUsize> {
    fn from(infer_schema_length: InferSchemaLength) -> Self {
        match infer_schema_length {
            InferSchemaLength::Len(len) => Some(len),
            InferSchemaLength::Inf => None,
            InferSchemaLength::Default => Some(DEFAULT_INITIAL_SCHEMA_LENGTH),
        }
    }
}

impl From<InferSchemaLength> for Option<usize> {
    fn from(infer_schema_length: InferSchemaLength) -> Self {
        let nonzero: Option<NonZeroUsize> = infer_schema_length.into();
        nonzero.map(|i| i.get())
    }
}

impl TryFrom<Option<&str>> for InferSchemaLength {
    type Error = anyhow::Error;

    fn try_from(value: Option<&str>) -> Result<Self, Self::Error> {
        if let Some(value) = value {
            if value.to_lowercase() == "inf" {
                Ok(InferSchemaLength::Inf)
            } else {
                let try_parsed = value.parse::<NonZeroUsize>();
                if let Ok(i) = try_parsed {
                    Ok(InferSchemaLength::Len(i))
                } else {
                    Err(anyhow!(
                        "Invalid value for infer-schema-length: '{}'. Using default value of {DEFAULT_INITIAL_SCHEMA_LENGTH}.",
                        value
                    ))
                }
            }
        } else {
            Ok(InferSchemaLength::Default)
        }
    }
}

impl std::fmt::Display for InferSchemaLength {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            InferSchemaLength::Len(len) => len.get().to_string(),
            InferSchemaLength::Inf => "Inf".to_string(),
            InferSchemaLength::Default => DEFAULT_INITIAL_SCHEMA_LENGTH.get().to_string(),
        };

        write!(f, "{}", s)
    }
}

#[derive(Parser, PartialEq, Default)]
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

struct ReadData {
    target: PathBuf,
    data_type: Option<ReadDataType>,
    name: Option<String>,
    options: HashMap<String, String>,
}

fn args_to_data(args: MyArgs, cwd: Option<PathBuf>) -> Result<Option<ReadData>> {
    let MyArgs {
        input,
        file_type,
        separator,
        infer_schema_length,
        name,
        port: _,
    } = args;

    let target = input.as_ref().map(|s| {
        let path = PathBuf::from(s);
        if let (true, Some(cwd)) = (path.is_relative(), cwd) {
            cwd.join(&path)
        } else {
            path
        }
    });

    // TinputTarget::StdInは実際には現れない
    // single instance pluginでコマンドライン引数を受け取るときに、stdinを受け取れないため、それにあわせる
    if let Some(target) = target {
        let data_type: Option<ReadDataType> =
            file_type.map(|s| s.as_str().try_into()).transpose()?;

        let mut options = HashMap::new();

        if let Some(separator) = separator {
            options.insert("delim".to_string(), separator.to_string());
        }

        match infer_schema_length {
            InferSchemaLength::Inf => {
                options.insert("sample_size".to_string(), "-1".to_string());
            }
            InferSchemaLength::Len(len) => {
                options.insert("sample_size".to_string(), len.get().to_string());
            }
            InferSchemaLength::Default => {}
        };

        Ok(Some(ReadData {
            target,
            data_type,
            name,
            options,
        }))
    } else {
        Ok(None)
    }
}

fn opened_event_listener(app_handle: &AppHandle, urls: Vec<Url>) -> Result<()> {
    log::debug!("Opened: {:?}", urls);
    if urls[0].scheme() == "file" {
        ensure!(urls.len() == 1, "Only one file can be opened at a time.");

        let file_path = Path::new(urls[0].path());

        // Stateを取得出来ていなかったら初期化する
        let state = app_handle.try_state::<Mutex<AppData>>().unwrap_or_else(|| {
            app_handle.manage(Mutex::new(AppData::try_new(None).unwrap()));
            app_handle.state::<Mutex<AppData>>()
        });

        let mut state = state.lock().unwrap();

        let table_name =
            state
                .dbstate
                .register_data(file_path, None, None, true, HashMap::new())?;

        app_handle.emit("update-data", table_name)?;
        Ok(())
    } else {
        Ok(())
    }
}

fn setup(app: &mut App) -> Result<()> {
    let args: MyArgs = app.cli().matches()?.args.try_into()?;

    // openedイベント経由の場合に上書きしないように、argsが指定されているかを確認する
    // finderから開く場合は、defaultと同じなはずなので、その場合はスキップ
    if args != MyArgs::default() {
        if let Some(read_data) = args_to_data(args, None)? {
            let state = app.state::<Mutex<AppData>>();
            let mut state = state.lock().unwrap();

            state.dbstate.register_data(
                &read_data.target,
                read_data.name.as_deref(),
                read_data.data_type,
                true,
                read_data
                    .options
                    .iter()
                    .map(|(k, v)| (k.as_str(), v.as_str()))
                    .collect(),
            )?;
        }
    }

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
    app_handle_clone.emit("update-status", ()).unwrap();

    axum::serve(listener, app).await?;

    Err(anyhow::anyhow!("Server stopped."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_data = Mutex::new(AppData::try_new(None).unwrap());

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
                    .and_then(|read_data| {
                        if let Some(read_data) = read_data {
                            let state = app_handle.state::<Mutex<AppData>>();
                            let mut state = state.lock().unwrap();

                            let table_name = state.dbstate.register_data(
                                &read_data.target,
                                read_data.name.as_deref(),
                                read_data.data_type,
                                true,
                                read_data
                                    .options
                                    .iter()
                                    .map(|(k, v)| (k.as_str(), v.as_str()))
                                    .collect(),
                            )?;

                            app_handle.emit("update-data", table_name)?;
                        }

                        Ok(())
                    })
                    .map(|_| {
                        // できたらフォーカスする。失敗してもエラーにはせず潰す。
                        let _ = app_handle
                            .get_webview_window("main")
                            .map(|window| window.set_focus());
                    });

                if let Err(err) = result {
                    let error_message = format!("Error in single instance init: {}", err);
                    log::error!("{}", &error_message);
                    let state = app_handle.state::<Mutex<AppData>>();
                    let mut state = state.lock().unwrap();

                    state.last_backend_error = Some(error_message);
                    app_handle.emit("update-status", ()).unwrap();
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .invoke_handler(tauri::generate_handler![
            register_data,
            get_status,
            execute_query,
            extract_table,
            get_table_names,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    let app_handle = app.handle().clone();

    tauri::async_runtime::spawn(async move {
        let app_handle_clone = app_handle.clone();
        if let Err(err) = server_setup(app_handle).await {
            let error_message = format!("Server error: {}", err);
            log::error!("{}", &error_message);
            let state = app_handle_clone.state::<Mutex<AppData>>();
            let mut state = state.lock().unwrap();
            state.port = None;
            state.last_backend_error = Some(error_message);
            app_handle_clone.emit("update-status", ()).unwrap();
        }
    });

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            log::debug!("Opened: {:?}", urls);
            log::info!("Opened: {:?}", urls);
            let result = opened_event_listener(app_handle, urls);

            if let Err(err) = result {
                let error_message = format!("Error in opened event: {}", err);
                log::error!("{}", &error_message);

                let state = app_handle.state::<Mutex<AppData>>();
                let mut state = state.lock().unwrap();
                state.last_backend_error = Some(error_message);
                app_handle.emit("update-status", ()).unwrap();
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
        Ok(read_data) => {
            if let Some(read_data) = read_data {
                let state = app_handle.state::<Mutex<AppData>>();
                let mut state = state.lock().unwrap();

                let table_name = state
                    .dbstate
                    .register_data(
                        &read_data.target,
                        read_data.name.as_deref(),
                        read_data.data_type,
                        true,
                        read_data
                            .options
                            .iter()
                            .map(|(k, v)| (k.as_str(), v.as_str()))
                            .collect(),
                    )
                    .unwrap();

                app_handle.emit("update-data", table_name).unwrap();
            }

            // できたらフォーカスする。失敗してもエラーにはせず潰す。
            let _ = app_handle
                .get_webview_window("main")
                .map(|window| window.set_focus());

            StatusCode::OK.into_response()
        }

        Err(e) => {
            let error_message = format!("Internal server error: {}", e);
            let state = app_handle.state::<Mutex<AppData>>();
            let mut state = state.lock().unwrap();
            state.last_backend_error = Some(error_message.clone());
            let _ = app_handle.emit("update-status", ());

            (StatusCode::INTERNAL_SERVER_ERROR, error_message).into_response()
        }
    }
}
