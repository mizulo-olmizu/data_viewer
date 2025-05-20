use polars::prelude::*;
use polars_sql::SQLContext;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::ops::{Deref, DerefMut};
use std::sync::Mutex;
use tauri::{App, Manager, State};
use tauri_plugin_cli::CliExt;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
struct ExtractDataResult {
    file_path: String,
    df: String,
    schema: Schema,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct SchemaField {
    name: String,
    dtype: String,
}

type Schema = Vec<SchemaField>;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct NewDataFrame(DataFrame);

impl From<DataFrame> for NewDataFrame {
    fn from(df: DataFrame) -> Self {
        NewDataFrame::new(df)
    }
}

impl Deref for NewDataFrame {
    type Target = DataFrame;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for NewDataFrame {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl NewDataFrame {
    fn new(df: DataFrame) -> Self {
        NewDataFrame(df)
    }

    fn get_schema(&self) -> Schema {
        self.schema()
            .iter()
            .map(|(name, dtype)| SchemaField {
                name: name.to_string(),
                dtype: dtype.to_string(),
            })
            .collect()
    }

    #[allow(dead_code)]
    fn summarize(&self) -> Vec<Summary> {
        self.get_columns()
            .iter()
            .map(|cl| {
                let column_name = cl.name().to_string();

                match cl.dtype() {
                    // 数値型、日付型、時間型
                    DataType::Decimal(_, _)
                    | DataType::Float32
                    | DataType::Float64
                    | DataType::Int8
                    | DataType::Int16
                    | DataType::Int32
                    | DataType::Int64
                    | DataType::Int128
                    | DataType::UInt8
                    | DataType::UInt16
                    | DataType::UInt32
                    | DataType::UInt64 => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;
                        let max: Option<f64> = series.max().ok().flatten();
                        let min: Option<f64> = series.min().ok().flatten();
                        let median = series.median();
                        let q1 = series
                            .quantile_reduce(0.25, QuantileMethod::Nearest)
                            .ok()
                            .and_then(|s| s.as_any_value().try_extract::<f64>().ok());
                        let q3 = series
                            .quantile_reduce(0.75, QuantileMethod::Nearest)
                            .ok()
                            .and_then(|s| s.as_any_value().try_extract::<f64>().ok());
                        let mean = series.mean();

                        Summary::Numeric(NumericSummary {
                            column_name,
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            min,
                            q1,
                            median,
                            q3,
                            max,
                            mean,
                        })
                    }

                    DataType::String | DataType::Boolean => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;
                        let value_counts = cl
                            .as_materialized_series()
                            .value_counts(false, false, "count".into(), false)
                            .and_then(|df| {
                                df.lazy()
                                    .with_column(
                                        (col("count") / col("count").sum().cast(DataType::Float64))
                                            .alias("prop"),
                                    )
                                    .collect()
                            })
                            .ok()
                            .map(|df| {
                                let cols = df.take_columns();
                                if cols.len() != 3 {
                                    return vec![];
                                }
                                let values = cols[0].as_materialized_series().iter();
                                let counts = cols[1].as_materialized_series().iter();
                                let props = cols[2].as_materialized_series().iter();

                                values
                                    .zip(counts)
                                    .zip(props)
                                    .map(|((v, c), p)| ValueCount {
                                        value: v.str_value().into(),
                                        count: c.try_extract::<u32>().ok(),
                                        prop: p.try_extract::<f64>().ok(),
                                    })
                                    .collect::<Vec<_>>()
                            });

                        Summary::Categorical(CategoricalSummary {
                            column_name,
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            value_counts,
                        })
                    }

                    _ => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;

                        Summary::Other(OtherSummary {
                            column_name,
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                        })
                    }
                }
            })
            .collect()
    }

    fn get_json(&mut self) -> String {
        let mut buffer = Cursor::new(Vec::new());

        JsonWriter::new(&mut buffer)
            .with_json_format(JsonFormat::Json)
            .finish(self)
            .unwrap();

        String::from_utf8(buffer.into_inner()).unwrap()
    }
}

#[tauri::command]
fn extract_data(state: State<'_, Mutex<AppData>>) -> ExtractDataResult {
    let state = state.lock().unwrap();

    let file_path = state.file_path.clone();

    let mut data = state
        .df
        .clone()
        .unwrap_or_else(|| DataFrame::new(vec![]).unwrap().into());

    ExtractDataResult {
        file_path: file_path.unwrap_or_else(|| String::from("")),
        df: data.get_json(),
        schema: data.get_schema(),
    }
}

#[tauri::command]
fn register_data(file_path: &str, state: State<'_, Mutex<AppData>>) -> Result<(), String> {
    let data = CsvReadOptions::default()
        .with_has_header(true)
        .try_into_reader_with_file_path(Some(file_path.into()))
        .and_then(|reader| reader.finish())
        .map_err(|_| "register data error!".to_owned())?;

    let mut state = state.lock().unwrap();
    state.file_path = Some(file_path.to_owned());
    state.df = Some(data.into());
    Ok(())
}

#[tauri::command]
fn execute_query(query: &str, state: State<'_, Mutex<AppData>>) -> Result<String, String> {
    let state = state.lock().unwrap();
    let lf = state.df.clone().ok_or("No DataFrame found")?.0.lazy();

    let mut ctx = SQLContext::new();

    ctx.register("self", lf);

    let mut result = ctx
        .execute(query)
        .and_then(|lf| lf.collect())
        .map_err(|e| {
            eprintln!("{:?}", e);
            "Query execution error!".to_owned()
        })?;

    let mut buffer = Cursor::new(Vec::new());
    JsonWriter::new(&mut buffer)
        .with_json_format(JsonFormat::Json)
        .finish(&mut result)
        .unwrap();

    Ok(String::from_utf8(buffer.into_inner()).unwrap())
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct NumericSummary {
    column_name: String,
    not_null_count: Option<usize>,
    null_count: Option<usize>,
    min: Option<f64>,
    q1: Option<f64>,
    median: Option<f64>,
    q3: Option<f64>,
    max: Option<f64>,
    mean: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct ValueCount {
    value: String,
    count: Option<u32>,
    prop: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct CategoricalSummary {
    column_name: String,
    not_null_count: Option<usize>,
    null_count: Option<usize>,
    value_counts: Option<Vec<ValueCount>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
struct OtherSummary {
    column_name: String,
    not_null_count: Option<usize>,
    null_count: Option<usize>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
enum Summary {
    Numeric(NumericSummary),
    Categorical(CategoricalSummary),
    Other(OtherSummary),
}

struct AppData {
    file_path: Option<String>,
    df: Option<NewDataFrame>,
}

fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let args = app.cli().matches()?.args;

    let file_path = args
        .get("file_path")
        .and_then(|arg_data| arg_data.value.as_str());

    let df = file_path
        .map(|file_path| {
            CsvReadOptions::default()
                .with_has_header(true)
                .try_into_reader_with_file_path(Some(file_path.into()))
                .and_then(|reader| reader.finish())
        })
        .transpose()?
        .map(|df| df.into());

    app.manage(Mutex::new(AppData {
        file_path: file_path.map(|s| s.to_owned()),
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
        .invoke_handler(tauri::generate_handler![
            extract_data,
            register_data,
            execute_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
