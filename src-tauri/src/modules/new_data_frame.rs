use anyhow::{anyhow, Result};
use chrono_tz::Tz;
use polars::io::mmap::MmapBytesReader;
use polars::prelude::*;
use polars_sql::SQLContext;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Cursor, Read};
use std::num::NonZeroUsize;
use std::ops::{Deref, DerefMut};
use std::path::PathBuf;

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

impl Default for NewDataFrame {
    fn default() -> Self {
        NewDataFrame(DataFrame::new(vec![]).unwrap())
    }
}

impl NewDataFrame {
    pub fn new(df: DataFrame) -> Self {
        NewDataFrame(df)
    }

    pub fn read_data(kind: ReadDataKind) -> Result<Self> {
        match kind {
            ReadDataKind::Csv(target, csv_option) => {
                let options = CsvReadOptions::default()
                    .with_has_header(true)
                    .with_infer_schema_length(csv_option.infer_schema_length.into())
                    .with_parse_options(
                        CsvParseOptions::default()
                            .with_try_parse_dates(true)
                            .with_separator(csv_option.separator.unwrap_or(',') as u8),
                    );

                let df = options
                    .into_reader_with_file_handle(target.generate_reader()?)
                    .finish()?;
                Ok(df.into())
            }

            ReadDataKind::Json(
                target,
                JsonOption {
                    infer_schema_length,
                },
            ) => Ok(JsonReader::new(target.generate_reader()?)
                .infer_schema_len(infer_schema_length.into())
                .finish()?
                .into()),

            ReadDataKind::JsonLine(
                target,
                JsonLineOption {
                    infer_schema_length,
                },
            ) => Ok(JsonLineReader::new(target.generate_reader()?)
                .infer_schema_len(infer_schema_length.into())
                .finish()?
                .into()),

            ReadDataKind::Parquet(file_path) => {
                Ok(ParquetReader::new(File::open(file_path)?).finish()?.into())
            }
        }
    }

    pub fn get_schema(&self) -> Schema {
        self.schema()
            .iter()
            .map(|(name, dtype)| SchemaField {
                name: name.to_string(),
                dtype: dtype.to_string(),
                dtype_group: dtype.into(),
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

                match DtypeGroup::from(cl.dtype()) {
                    DtypeGroup::Numeric => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;

                        let statistics = calculate_statistics(series);

                        let bins = binning(series).ok();

                        let raw = convert_f64_vec(series).unwrap_or_default();

                        Summary::Numeric(NumericSummary {
                            column_name,
                            dtype: cl.dtype().to_string(),
                            dtype_group: cl.dtype().into(),
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            statistics,
                            bins,
                            raw,
                        })
                    }

                    DtypeGroup::Date
                    | DtypeGroup::Datetime
                    | DtypeGroup::Time
                    | DtypeGroup::Duration => {
                        let timezone = if let DataType::Datetime(_, Some(tz)) = cl.dtype() {
                            tz.to_chrono().ok()
                        } else {
                            None
                        };

                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;

                        let numeric_series: Series = series
                            .cast(&DataType::Int64)
                            .unwrap()
                            .i64()
                            .unwrap()
                            .into_iter()
                            .map(|opt| {
                                if let Some(i) = opt {
                                    match cl.dtype() {
                                        DataType::Date => Some(i * 24 * 60 * 60 * 1_000),
                                        DataType::Datetime(_, _) => Some(i / 1_000),
                                        DataType::Time => Some(i / 1_000_000),
                                        DataType::Duration(time_unit) => match time_unit {
                                            TimeUnit::Nanoseconds => Some(i / 1_000_000),
                                            TimeUnit::Microseconds => Some(i / 1_000),
                                            TimeUnit::Milliseconds => Some(i),
                                        },
                                        _ => unreachable!(),
                                    }
                                } else {
                                    None
                                }
                            })
                            .collect();

                        let numeric_statistics = calculate_statistics(&numeric_series);

                        let numeric_bins = binning(&numeric_series).ok();

                        let numeric_raw = convert_i64_vec(&numeric_series).unwrap_or_default();

                        Summary::Temporal(TemporalSummary {
                            column_name: column_name.clone(),
                            dtype: cl.dtype().to_string(),
                            dtype_group: cl.dtype().into(),
                            timezone,
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            numeric_statistics,
                            numeric_bins,
                            numeric_raw,
                        })
                    }

                    DtypeGroup::String => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;
                        let unique_count = series.n_unique().ok();

                        let len_range = series
                            .str()
                            .map(|s| {
                                let min = s.iter().flatten().map(|s| s.len()).min();
                                let max = s.iter().flatten().map(|s| s.len()).max();

                                (min, max)
                            })
                            .ok();

                        let value_counts = value_counts(cl);

                        Summary::String(StringSummary {
                            column_name,
                            dtype: cl.dtype().to_string(),
                            dtype_group: cl.dtype().into(),
                            not_null_count: Some(non_null_count),
                            unique_count,
                            min_len: len_range.and_then(|(min, _)| min),
                            max_len: len_range.and_then(|(_, max)| max),
                            null_count: Some(null_count),
                            value_counts,
                        })
                    }

                    DtypeGroup::Boolean => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;
                        let value_counts = value_counts(cl);

                        Summary::Boolean(BooleanSummary {
                            column_name,
                            dtype: cl.dtype().to_string(),
                            dtype_group: cl.dtype().into(),
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            value_counts,
                        })
                    }

                    DtypeGroup::Nested | DtypeGroup::Other => {
                        let series = cl.as_materialized_series();
                        let null_count = series.null_count();
                        let non_null_count = series.len() - null_count;

                        Summary::Other(OtherSummary {
                            column_name,
                            dtype: cl.dtype().to_string(),
                            dtype_group: cl.dtype().into(),
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
#[serde(rename_all = "camelCase", tag = "type")]
pub enum DtypeGroup {
    Numeric,
    Date,
    Datetime,
    Time,
    Duration,
    String,
    Boolean,
    Nested,
    Other,
}

impl From<&DataType> for DtypeGroup {
    fn from(dtype: &DataType) -> Self {
        match dtype {
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
            | DataType::UInt64 => DtypeGroup::Numeric,
            DataType::Date => DtypeGroup::Date,
            DataType::Datetime(_, _) => DtypeGroup::Datetime,
            DataType::Time => DtypeGroup::Time,
            DataType::Duration(_) => DtypeGroup::Duration,
            DataType::String | DataType::Enum(_, _) | DataType::Categorical(_, _) => {
                DtypeGroup::String
            }
            DataType::Boolean => DtypeGroup::Boolean,
            DataType::List(_) | DataType::Struct(_) | DataType::Array(_, _) => DtypeGroup::Nested,
            DataType::Binary | DataType::BinaryOffset | DataType::Null | DataType::Unknown(_) => {
                DtypeGroup::Other
            }
        }
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SchemaField {
    pub name: String,
    pub dtype: String,
    pub dtype_group: DtypeGroup,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone, Default)]
pub struct NumericStatistics {
    pub min: Option<f64>,
    pub q1: Option<f64>,
    pub median: Option<f64>,
    pub q3: Option<f64>,
    pub max: Option<f64>,
    pub mean: Option<f64>,
    pub std: Option<f64>,
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
    pub dtype: String,
    pub dtype_group: DtypeGroup,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub statistics: NumericStatistics,
    pub bins: Option<Vec<NumericBin>>,
    pub raw: Vec<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemporalSummary {
    pub column_name: String,
    pub dtype: String,
    pub dtype_group: DtypeGroup,
    pub timezone: Option<Tz>,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub numeric_statistics: NumericStatistics,
    pub numeric_bins: Option<Vec<NumericBin>>,
    pub numeric_raw: Vec<i64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StringSummary {
    pub column_name: String,
    pub dtype: String,
    pub dtype_group: DtypeGroup,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub min_len: Option<usize>,
    pub max_len: Option<usize>,
    pub unique_count: Option<usize>,
    pub value_counts: Option<Vec<ValueCount>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BooleanSummary {
    pub column_name: String,
    pub dtype: String,
    pub dtype_group: DtypeGroup,
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
    pub dtype: String,
    pub dtype_group: DtypeGroup,
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
pub struct CsvOption {
    pub separator: Option<char>,
    pub infer_schema_length: InferSchemaLength,
}

#[derive(Debug, PartialEq, Clone)]
pub struct JsonOption {
    pub infer_schema_length: InferSchemaLength,
}

#[derive(Debug, PartialEq, Clone)]
pub struct JsonLineOption {
    pub infer_schema_length: InferSchemaLength,
}

#[derive(Debug, PartialEq, Clone)]
pub enum InputTarget {
    StdIn,
    FilePath(PathBuf),
}

impl InputTarget {
    pub fn generate_reader(&self) -> Result<Box<dyn MmapBytesReader>> {
        match self {
            Self::StdIn => {
                let mut input_data = String::new();
                io::stdin().lock().read_to_string(&mut input_data)?;
                Ok(Box::new(Cursor::new(input_data)))
            }
            Self::FilePath(file_path) => {
                let file = File::open(file_path)?;
                Ok(Box::new(file))
            }
        }
    }
}

impl From<PathBuf> for InputTarget {
    fn from(path: PathBuf) -> Self {
        InputTarget::FilePath(path)
    }
}

#[derive(Debug, PartialEq, Clone)]
pub enum ReadDataKind {
    Csv(InputTarget, CsvOption),
    Json(InputTarget, JsonOption),
    JsonLine(InputTarget, JsonLineOption),
    Parquet(PathBuf),
}

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

impl ReadDataKind {
    pub fn from_path(
        path: PathBuf,
        csv_separator: Option<char>,
        infer_schema_length: InferSchemaLength,
    ) -> Self {
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_owned());
        match extension.as_deref() {
            Some("tsv") => ReadDataKind::Csv(
                path.into(),
                CsvOption {
                    separator: Some(csv_separator.unwrap_or('\t')),
                    infer_schema_length,
                },
            ),
            Some("json") => ReadDataKind::Json(
                path.into(),
                JsonOption {
                    infer_schema_length,
                },
            ),
            Some("jsonl") => ReadDataKind::JsonLine(
                path.into(),
                JsonLineOption {
                    infer_schema_length,
                },
            ),
            Some("parquet") => ReadDataKind::Parquet(path),
            _ => ReadDataKind::Csv(
                path.into(),
                CsvOption {
                    separator: csv_separator,
                    infer_schema_length,
                },
            ),
        }
    }
}

fn convert_f64_vec(series: &Series) -> Result<Vec<f64>> {
    Ok(series
        .cast(&DataType::Float64)?
        .f64()?
        .into_iter()
        .flatten()
        .collect())
}

fn convert_i64_vec(series: &Series) -> Result<Vec<i64>> {
    Ok(series
        .cast(&DataType::Int64)?
        .i64()?
        .into_iter()
        .flatten()
        .collect())
}

fn calculate_statistics(series: &Series) -> NumericStatistics {
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

    NumericStatistics {
        min,
        q1,
        median,
        q3,
        max,
        mean,
        std,
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NumericBin {
    pub lower: f64,
    pub upper: f64,
    pub count: u32,
}

fn binning(series: &Series) -> Result<Vec<NumericBin>> {
    let values = series
        .cast(&DataType::Float64)?
        .f64()?
        .into_iter()
        .flatten()
        .collect::<Vec<f64>>();

    if values.is_empty() {
        return Err(anyhow!("Series is empty"));
    }

    let n = values.len();
    let bin_count = (n as f64).log2().ceil() as usize + 1;

    let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    let bin_width = (max - min) / bin_count as f64;

    let mut bins = Vec::new();

    for i in 0..bin_count {
        let lower = min + i as f64 * bin_width;
        let upper = if i == bin_count - 1 {
            max
        } else {
            lower + bin_width
        };
        bins.push(NumericBin {
            lower,
            upper,
            count: 0,
        });
    }

    // 各値をビンに振り分け
    for value in values {
        for (i, bin) in bins.iter_mut().enumerate() {
            let NumericBin {
                lower,
                upper,
                count,
            } = bin;
            if (value >= *lower && value < *upper) || (i == bin_count - 1 && value == *upper) {
                *count += 1;
                break;
            }
        }
    }

    Ok(bins)
}
