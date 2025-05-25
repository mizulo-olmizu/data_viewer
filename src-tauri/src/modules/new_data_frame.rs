use anyhow::Result;
use polars::prelude::*;
use polars_sql::SQLContext;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Cursor, Read};
use std::ops::{Deref, DerefMut};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct NewDataFrame(DataFrame);

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
    pub fn new(df: DataFrame) -> Self {
        NewDataFrame(df)
    }

    pub fn read_data(kind: ReadDataKind) -> Result<Self> {
        match kind {
            ReadDataKind::Csv(csv_option) => {
                let options = CsvReadOptions::default()
                    .with_has_header(true)
                    .with_parse_options(
                        CsvParseOptions::default()
                            .with_try_parse_dates(true)
                            .with_separator(csv_option.separator as u8),
                    );

                match csv_option.target {
                    InputTarget::StdIn => {
                        let mut input_data = String::new();
                        io::stdin().lock().read_to_string(&mut input_data)?;
                        let cursor = Cursor::new(input_data);
                        let df = options.into_reader_with_file_handle(cursor).finish()?;
                        Ok(df.into())
                    }

                    InputTarget::FilePath(file_path) => {
                        let df = options
                            .try_into_reader_with_file_path(Some(file_path.to_owned()))
                            .and_then(|reader| reader.finish())?;
                        Ok(df.into())
                    }
                }
            }

            ReadDataKind::Json(InputTarget::StdIn) => {
                let mut input_data = String::new();
                io::stdin().lock().read_to_string(&mut input_data)?;
                let mut cursor = Cursor::new(input_data);
                let df = JsonReader::new(&mut cursor).finish()?;
                Ok(df.into())
            }

            ReadDataKind::Json(InputTarget::FilePath(file_path)) => {
                let mut file = File::open(file_path)?;
                let df = JsonReader::new(&mut file).finish()?;
                Ok(df.into())
            }

            ReadDataKind::JsonLine(InputTarget::StdIn) => {
                let mut input_data = String::new();
                io::stdin().lock().read_to_string(&mut input_data)?;
                let mut cursor = Cursor::new(input_data);
                let df = JsonLineReader::new(&mut cursor).finish()?;
                Ok(df.into())
            }

            ReadDataKind::JsonLine(InputTarget::FilePath(file_path)) => {
                let mut file = File::open(file_path)?;
                let df = JsonLineReader::new(&mut file).finish()?;
                Ok(df.into())
            }

            ReadDataKind::Parquet(InputTarget::StdIn) => {
                let mut input_data = String::new();
                io::stdin().lock().read_to_string(&mut input_data)?;
                let mut cursor = Cursor::new(input_data);
                let df = ParquetReader::new(&mut cursor).finish()?;
                Ok(df.into())
            }

            ReadDataKind::Parquet(InputTarget::FilePath(file_path)) => {
                let mut file = File::open(file_path)?;
                let df = ParquetReader::new(&mut file).finish()?;
                Ok(df.into())
            }
        }
    }

    pub fn get_schema(&self) -> Schema {
        self.schema()
            .iter()
            .map(|(name, dtype)| SchemaField {
                name: name.to_string(),
                dtype: dtype.to_string(),
            })
            .collect()
    }

    pub fn time_to_str(self) -> Result<Self> {
        // time型をstring型に変換する
        let mut exprs: Vec<Expr> = vec![];

        for c in self.materialized_column_iter() {
            if c.dtype() == &DataType::Time {
                let expr = col(c.name().as_str()).cast(DataType::String);
                exprs.push(expr);
            }
        }

        let df = self.0.lazy().with_columns(exprs).collect()?;
        Ok(NewDataFrame::new(df))
    }

    pub fn summarize(&self) -> Vec<Summary> {
        self.get_columns()
            .iter()
            .map(|cl| {
                let column_name = cl.name().to_string();

                match cl.dtype() {
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
                        let std = series.std(1);

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
                            std,
                        })
                    }

                    DataType::Date | DataType::Datetime(_, _) | DataType::Time => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;

                        let exprs = vec![
                            col(series.name().as_str()).max().alias("max"),
                            col(series.name().as_str()).min().alias("min"),
                            col(series.name().as_str()).median().alias("median"),
                            col(series.name().as_str()).mean().alias("mean"),
                        ];

                        series
                            .clone()
                            .into_frame()
                            .lazy()
                            .select(exprs)
                            .collect()
                            .map(|agg_df| {
                                let min = agg_df
                                    .column("min")
                                    .ok()
                                    .and_then(|c| c.get(0).ok())
                                    .map(|field| field.to_string());

                                let max = agg_df
                                    .column("max")
                                    .ok()
                                    .and_then(|c| c.get(0).ok())
                                    .map(|field| field.to_string());

                                let median = agg_df
                                    .column("median")
                                    .ok()
                                    .and_then(|c| c.get(0).ok())
                                    .map(|field| field.to_string());

                                let mean = agg_df
                                    .column("mean")
                                    .ok()
                                    .and_then(|c| c.get(0).ok())
                                    .map(|field| field.to_string());

                                Summary::Temporal(TemporalSummary {
                                    column_name: column_name.clone(),
                                    not_null_count: Some(non_null_count),
                                    null_count: Some(null_count),
                                    min,
                                    median,
                                    max,
                                    mean,
                                })
                            })
                            .unwrap_or_else(|_| {
                                Summary::Temporal(TemporalSummary {
                                    column_name,
                                    not_null_count: Some(non_null_count),
                                    null_count: Some(null_count),
                                    min: None,
                                    median: None,
                                    max: None,
                                    mean: None,
                                })
                            })
                    }

                    DataType::String => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;
                        let unique_count = series.n_unique().ok();
                        let value_counts = value_counts(cl);

                        Summary::String(StringSummary {
                            column_name,
                            not_null_count: Some(non_null_count),
                            unique_count,
                            null_count: Some(null_count),
                            value_counts,
                        })
                    }

                    DataType::Boolean => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;
                        let value_counts = value_counts(cl);

                        Summary::Boolean(BooleanSummary {
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

    pub fn get_json(&mut self) -> Result<String> {
        let mut buffer = Cursor::new(Vec::new());

        JsonWriter::new(&mut buffer)
            .with_json_format(JsonFormat::Json)
            .finish(self)?;

        let result = String::from_utf8(buffer.into_inner())?;

        Ok(result)
    }

    pub fn execute_query(self, query: &str) -> Result<Self> {
        let lf = self.0.clone().lazy();

        let mut ctx = SQLContext::new();

        ctx.register("self", lf);

        let result = ctx.execute(query).and_then(|lf| lf.collect())?;

        Ok(result.into())
    }
}

pub type Schema = Vec<SchemaField>;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct SchemaField {
    pub name: String,
    pub dtype: String,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Summary {
    Numeric(NumericSummary),
    Temporal(TemporalSummary),
    String(StringSummary),
    Boolean(BooleanSummary),
    Other(OtherSummary),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NumericSummary {
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub min: Option<f64>,
    pub q1: Option<f64>,
    pub median: Option<f64>,
    pub q3: Option<f64>,
    pub max: Option<f64>,
    pub mean: Option<f64>,
    pub std: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemporalSummary {
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub min: Option<String>,
    pub median: Option<String>,
    pub max: Option<String>,
    pub mean: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StringSummary {
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub unique_count: Option<usize>,
    pub value_counts: Option<Vec<ValueCount>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BooleanSummary {
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub value_counts: Option<Vec<ValueCount>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValueCount {
    pub value: String,
    pub count: Option<u32>,
    pub prop: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OtherSummary {
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
}

fn value_counts(cl: &Column) -> Option<Vec<ValueCount>> {
    cl.as_materialized_series()
        .value_counts(true, false, "count".into(), false)
        .and_then(|df| {
            df.lazy()
                .with_column(
                    (col("count") / col("count").sum().cast(DataType::Float64)).alias("prop"),
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
        })
}

#[derive(Debug, PartialEq, Clone)]
pub struct CsvOption<'a> {
    pub separator: char,
    pub target: InputTarget<'a>,
}

#[derive(Debug, PartialEq, Clone)]
pub enum InputTarget<'a> {
    StdIn,
    FilePath(&'a Path),
}

#[derive(Debug, PartialEq, Clone)]
pub enum ReadDataKind<'a> {
    Csv(CsvOption<'a>),
    Json(InputTarget<'a>),
    JsonLine(InputTarget<'a>),
    Parquet(InputTarget<'a>),
}
