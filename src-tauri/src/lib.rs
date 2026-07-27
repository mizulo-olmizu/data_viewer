use crate::modules::handler::{
    app_log, dismiss_backend_error, drop_table, execute_query, extract_table, get_duckdb_symbols,
    get_logs, get_settings, get_status, get_table_names, load_persisted_app_settings,
    log_frontend_perf, new_in_memory_database, open_database, register_data, rename_table,
    save_database, save_text_file, set_settings, sql_fix, sql_lint, switch_http_port, AppData,
    LogLevel,
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
use tokio::sync::{mpsc, oneshot};

mod modules;

const DEFAULT_PORT: u16 = 3000;

// axumサーバーの稼働中ポートを切り替えるためのリクエスト。`reply`がSomeの場合(`switch_http_port`
// コマンド経由)、実際にbindが成功/失敗した結果をここへ返す。single-instance再起動時の`-p`指定
// (fire-and-forget)ではNoneにする。
pub struct PortSwitchRequest {
    pub port: u16,
    pub reply: Option<oneshot::Sender<Result<(), String>>>,
}

// PortSwitchRequestを送るためのチャネル。Tauriのmanaged stateとして登録する。
pub struct PortSwitch(pub mpsc::UnboundedSender<PortSwitchRequest>);

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
    #[arg(long, short = 'd')]
    db_path: Option<String>,
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

        let db_path = args
            .get("db-path")
            .and_then(|arg_data| arg_data.value.as_str());

        Ok(MyArgs {
            input: input.map(String::from),
            file_type: file_type.map(String::from),
            separator,
            name: name.map(String::from),
            infer_schema_length,
            port,
            db_path: db_path.map(String::from),
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
        db_path: _,
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
    app_log(app_handle, LogLevel::Info, format!("Opened: {:?}", urls));
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
    {
        let state = app.state::<Mutex<AppData>>();
        let mut state = state.lock().unwrap();
        load_persisted_app_settings(app, &mut state);
    }

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

// 初期起動時のポートを解決する。優先順位: CLI引数`-p`(その起動限りの一時上書き) >
// 設定画面(settings.json)に永続化された値 > DEFAULT_PORT。
fn resolve_initial_port(app_handle: &AppHandle) -> Result<u16> {
    let args: MyArgs = app_handle.cli().matches()?.args.try_into()?;

    let configured_port = {
        let state = app_handle.state::<Mutex<AppData>>();
        let state = state.lock().unwrap();
        state.configured_port()
    };

    Ok(args.port.or(configured_port).unwrap_or(DEFAULT_PORT))
}

fn build_router(app_handle: AppHandle) -> Router {
    Router::new()
        .route("/health-check", get(health_check))
        .route("/update-data", post(update_data))
        .with_state(app_handle)
}

fn set_active_port(app_handle: &AppHandle, port: Option<u16>) {
    let state = app_handle.state::<Mutex<AppData>>();
    //MutexGuardを保持したままawaitを呼び出さないよう、スコープを制限する
    {
        let mut state = state.lock().unwrap();
        state.port = port;
    }
    app_handle.emit("update-status", ()).unwrap();
}

// 指定ポートへのbindに失敗したことを伝える。呼び出し元は「今動いているサーバー」を
// 止めずに残す(このエラー報告自体はstate.portを変更しない)。
// `reply`があれば(switch_http_portコマンド経由、要求元が結果を直接待っている)そちらにだけ
// エラーを返す。グローバルなlast_backend_error/update-statusは使わない — そうしないと、
// この操作と無関係な後続の成功イベントでも同じエラーダイアログが再表示され続けてしまう
// (last_backend_errorは成功時にクリアされる仕組みが無いため)。
// `reply`が無い場合(single-instance再起動時の-p指定などfire-and-forget、および起動時の
// 初回bind失敗)は、他に知らせる手段が無いのでグローバル経由(last_backend_error)で伝える。
fn report_port_bind_error(
    app_handle: &AppHandle,
    port: u16,
    err: &std::io::Error,
    reply: Option<oneshot::Sender<Result<(), String>>>,
) {
    let message = format!("ポート{port}でのHTTPサーバー起動に失敗しました: {err}");
    app_log(
        app_handle,
        LogLevel::Warn,
        format!("Failed to bind to port {port}: {err}"),
    );

    match reply {
        Some(reply) => {
            let _ = reply.send(Err(message));
        }
        None => {
            {
                let state = app_handle.state::<Mutex<AppData>>();
                let mut state = state.lock().unwrap();
                state.last_backend_error = Some(message);
            }
            app_handle.emit("update-status", ()).unwrap();
        }
    }
}

// `port_rx`から届くリクエストのポートへのbindを試み、成功するまで(=起動できるまで)リトライし続ける。
// 起動時の初回bind、およびswitch_http_port等で指定されたポートが埋まっている場合の再試行の両方で使う。
async fn bind_with_retry(
    app_handle: &AppHandle,
    port_rx: &mut mpsc::UnboundedReceiver<PortSwitchRequest>,
) -> Result<(tokio::net::TcpListener, u16)> {
    let request = port_rx
        .recv()
        .await
        .ok_or_else(|| anyhow!("Port switch channel closed."))?;
    let mut port = request.port;
    let mut pending_reply = request.reply;
    // 起動時の純粋な初回成功(一度も失敗していない)ではhttp-port-changedを発火しない
    // (毎回の起動でトーストが出てしまうのを避けるため)。bind失敗を経て別ポートで復帰した
    // 場合は、他の切り替え成功時と同様にhttp-port-changedを発火してユーザーに明示する。
    let mut recovered_from_failure = false;

    loop {
        match tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await {
            Ok(listener) => {
                if let Some(reply) = pending_reply.take() {
                    let _ = reply.send(Ok(()));
                }
                if recovered_from_failure {
                    app_handle.emit("http-port-changed", port).unwrap();
                }
                return Ok((listener, port));
            }
            Err(err) => {
                recovered_from_failure = true;
                report_port_bind_error(app_handle, port, &err, pending_reply.take());
                // 次にport_rxへ新しいリクエストが届く(=別のポートが指定される)まで待って再試行する
                let request = port_rx
                    .recv()
                    .await
                    .ok_or_else(|| anyhow!("Port switch channel closed."))?;
                port = request.port;
                pending_reply = request.reply;
            }
        }
    }
}

// `port_rx`にリクエストが届く度にaxumサーバーを新ポートで起動し直す。切り替え時は、新ポートへの
// bindに先に成功してから旧サーバーをgraceful shutdownする(bind失敗時に旧サーバーごと
// 失ってしまわないように)。bindに失敗した場合はエラーを報告しつつ、別のポート指定を待ち続ける
// (起動そのものに失敗した場合を含め、稼働中のサーバーが無い「disabled」状態からも、
// 改めて別ポートを指定すれば復帰できる)。ただしこれはbind失敗時の話であり、bind以外の理由で
// この関数自体が異常終了した場合(axum/hyper内部の予期しないエラーなど、頻度は低い)は、
// 呼び出し元(run())が通常のエラー処理を行うのみで、この関数を再試行することはしない
// (そこまでの復旧を保証する価値は薄いと判断したため)。
async fn run_http_server(
    app_handle: AppHandle,
    mut port_rx: mpsc::UnboundedReceiver<PortSwitchRequest>,
) -> Result<()> {
    let (mut current_listener, mut current_port) =
        bind_with_retry(&app_handle, &mut port_rx).await?;
    app_log(
        &app_handle,
        LogLevel::Info,
        format!("server started on 127.0.0.1:{current_port}"),
    );
    set_active_port(&app_handle, Some(current_port));

    loop {
        let router = build_router(app_handle.clone());
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        let mut serve_task = tokio::spawn(async move {
            axum::serve(current_listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
        });

        let (new_listener, new_port, reply) = loop {
            tokio::select! {
                result = &mut serve_task => {
                    // 意図した切り替え(shutdown_tx経由)以外でサーバーが終了した場合は異常終了として扱う
                    return match result {
                        Ok(Ok(())) => Err(anyhow!("Server stopped.")),
                        Ok(Err(err)) => Err(err.into()),
                        Err(join_err) => Err(join_err.into()),
                    };
                }
                request = port_rx.recv() => {
                    let request = request.ok_or_else(|| anyhow!("Port switch channel closed."))?;

                    if request.port == current_port {
                        if let Some(reply) = request.reply {
                            let _ = reply.send(Ok(())); // 既に同じポートで稼働中なので成功扱い
                        }
                        continue;
                    }

                    match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", request.port)).await {
                        Ok(listener) => break (listener, request.port, request.reply),
                        Err(err) => {
                            // 新ポートへのbindに失敗。旧サーバー(current_listenerで稼働中)はそのまま維持し、
                            // エラーだけ報告して次のport変更を待つ。
                            report_port_bind_error(&app_handle, request.port, &err, request.reply);
                        }
                    }
                }
            }
        };

        // 新ポートへのbindに成功したので、旧サーバーをgraceful shutdownしてから切り替える
        let _ = shutdown_tx.send(());
        let _ = serve_task.await;

        current_listener = new_listener;
        current_port = new_port;
        app_log(
            &app_handle,
            LogLevel::Info,
            format!("server started on 127.0.0.1:{current_port}"),
        );
        set_active_port(&app_handle, Some(current_port));
        app_handle.emit("http-port-changed", current_port).unwrap();
        if let Some(reply) = reply {
            let _ = reply.send(Ok(()));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // tauri_plugin_cliはAppインスタンスが無いと使えないため、起動直後に必要なdb-pathだけ生のclapでパースする
    // (single instance再起動時のCLI引数パースと同じ方式)。不正な引数はこの時点では無視し、
    // setup()内のapp.cli().matches()によるパースでエラーとして表面化させる。
    let initial_db_path = MyArgs::try_parse_from(std::env::args())
        .ok()
        .and_then(|args| args.db_path);

    let app_data = match AppData::try_new(initial_db_path.as_deref()) {
        Ok(app_data) => Mutex::new(app_data),
        Err(err) => {
            eprintln!("Error opening database: {}", err);
            std::process::exit(1);
        }
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
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
            app_log(app.handle(), LogLevel::Info, "app setup done!");
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(
            |app_handle, args, cwd| {
                let result = MyArgs::try_parse_from(&args)
                    .map_err(|e| anyhow!(e))
                    .and_then(|args| {
                        // 既に起動しているインスタンスに対して-p/--portが指定された場合、確認なしで
                        // 即座にそちらへ切り替える(settings.jsonへの書き戻しは行わない、その起動限りの
                        // 一時的な上書き)。「既に同じポートかどうか」の判定はここでは行わず、
                        // run_http_server側の権威あるチェック(state.portを経由しない、ループ内の
                        // ローカル変数との比較)に一本化する。ここでstate.portを見て事前判定すると、
                        // 切り替え処理の完了(set_active_portによるstate.port更新)がその後に来る
                        // タイミングとの間でTOCTOU競合が起き、進行中の切り替えと同じポートへの
                        // 別リクエストが誤って握りつぶされることがあるため。
                        if let Some(port) = args.port {
                            let port_switch = app_handle.state::<PortSwitch>();
                            port_switch
                                .0
                                .send(PortSwitchRequest { port, reply: None })
                                .map_err(|_| anyhow!("HTTPサーバーが応答していません"))?;
                        }
                        let db_path = args.db_path.clone();
                        args_to_data(args, Some(PathBuf::from(cwd)))
                            .map(|read_data| (read_data, db_path))
                    })
                    .and_then(|(read_data, db_path)| {
                        // 既に起動しているインスタンスに対して-d/--db-pathが指定された場合、
                        // バックエンドで即座に接続を差し替えるのではなく、フロントエンドへリクエストを
                        // 通知するだけに留める。UIの「Open Database」と同じ確認フロー(メモリ上に
                        // 未保存のテーブルがあれば確認を挟む)を経由させ、CLI経由だけ確認なしで
                        // データが失われることが無いようにするため。
                        if let Some(db_path) = db_path {
                            app_handle.emit("open-database-requested", db_path)?;
                        }

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
                        let state = app_handle.state::<Mutex<AppData>>();
                        let focus_on_external_update =
                            state.lock().unwrap().focus_on_external_update();

                        if focus_on_external_update {
                            // できたらフォーカスする。失敗してもエラーにはせず潰す。
                            let _ = app_handle
                                .get_webview_window("main")
                                .map(|window| window.set_focus());
                        }
                    });

                if let Err(err) = result {
                    let error_message = format!("Error in single instance init: {}", err);
                    app_log(app_handle, LogLevel::Error, error_message.clone());
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
            sql_lint,
            sql_fix,
            get_duckdb_symbols,
            save_text_file,
            save_database,
            open_database,
            new_in_memory_database,
            get_settings,
            set_settings,
            switch_http_port,
            drop_table,
            rename_table,
            dismiss_backend_error,
            get_logs,
            log_frontend_perf,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // setup()フック(下のapp.run()内で実際に呼ばれるまで実行されない)を待っていると、
    // resolve_initial_port()がsettings.jsonの内容をまだ見られない。この時点で明示的に
    // 一度読み込んでおく(setup()側でも同じ処理を行うが、同じファイルを読み直すだけで副作用はない)。
    {
        let state = app.state::<Mutex<AppData>>();
        let mut state = state.lock().unwrap();
        load_persisted_app_settings(&app, &mut state);
    }

    let app_handle = app.handle().clone();

    let initial_port = match resolve_initial_port(&app_handle) {
        Ok(port) => port,
        Err(err) => {
            eprintln!("Error resolving initial port: {}", err);
            std::process::exit(1);
        }
    };
    let (port_tx, port_rx) = mpsc::unbounded_channel::<PortSwitchRequest>();
    app_handle.manage(PortSwitch(port_tx.clone()));
    // 起動時のポートも、後続のswitch_http_port等と同じリクエストとしてキューに積んでおく
    // (bind_with_retryは常にport_rxからリクエストを受け取る前提の作りになっている)。
    let _ = port_tx.send(PortSwitchRequest {
        port: initial_port,
        reply: None,
    });

    tauri::async_runtime::spawn(async move {
        let app_handle_clone = app_handle.clone();
        if let Err(err) = run_http_server(app_handle, port_rx).await {
            let error_message = format!("Server error: {}", err);
            app_log(&app_handle_clone, LogLevel::Error, error_message.clone());
            {
                let state = app_handle_clone.state::<Mutex<AppData>>();
                let mut state = state.lock().unwrap();
                state.port = None;
                state.last_backend_error = Some(error_message);
            }
            app_handle_clone.emit("update-status", ()).unwrap();
        }
    });

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            // "Opened: ..."自体のログはopened_event_listener内で行う
            let result = opened_event_listener(app_handle, urls);

            if let Err(err) = result {
                let error_message = format!("Error in opened event: {}", err);
                app_log(app_handle, LogLevel::Error, error_message.clone());

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
            db_path: None,
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
                let table_name = {
                    let state = app_handle.state::<Mutex<AppData>>();
                    let mut state = state.lock().unwrap();

                    state
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
                        .unwrap()
                };

                app_log(
                    &app_handle,
                    LogLevel::Info,
                    format!("update_data (HTTP): -> table '{table_name}'"),
                );
                app_handle.emit("update-data", table_name).unwrap();
            }

            let state = app_handle.state::<Mutex<AppData>>();
            let focus_on_external_update = state.lock().unwrap().focus_on_external_update();

            if focus_on_external_update {
                // できたらフォーカスする。失敗してもエラーにはせず潰す。
                let _ = app_handle
                    .get_webview_window("main")
                    .map(|window| window.set_focus());
            }

            StatusCode::OK.into_response()
        }

        Err(e) => {
            let error_message = format!("Internal server error: {}", e);
            app_log(&app_handle, LogLevel::Warn, error_message.clone());
            {
                let state = app_handle.state::<Mutex<AppData>>();
                let mut state = state.lock().unwrap();
                state.last_backend_error = Some(error_message.clone());
            }
            let _ = app_handle.emit("update-status", ());

            (StatusCode::INTERNAL_SERVER_ERROR, error_message).into_response()
        }
    }
}
