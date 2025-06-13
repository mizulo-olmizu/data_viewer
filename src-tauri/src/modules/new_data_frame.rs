use anyhow::{anyhow, Result};
use chrono_tz::Tz;
use polars::io::mmap::MmapBytesReader;
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
            ReadDataKind::Csv(target, csv_option) => {
                let options = CsvReadOptions::default()
                    .with_has_header(true)
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

            ReadDataKind::Json(target) => {
                Ok(JsonReader::new(target.generate_reader()?).finish()?.into())
            }

            ReadDataKind::JsonLine(target) => Ok(JsonLineReader::new(target.generate_reader()?)
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

                        let statistics = calculate_statistics(series);

                        let bins = binning(series).ok();

                        let raw = convert_f64_vec(series).unwrap_or_default();

                        Summary::Numeric(NumericSummary {
                            column_name,
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            statistics,
                            bins,
                            raw,
                        })
                    }

                    DataType::Date | DataType::Datetime(_, _) | DataType::Time => {
                        let sub_type = match cl.dtype() {
                            DataType::Date => TemporalSubType::Date,
                            DataType::Datetime(_, _) => TemporalSubType::Datetime,
                            DataType::Time => TemporalSubType::Time,
                            _ => unreachable!(),
                        };

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
                            sub_type,
                            timezone,
                            not_null_count: Some(non_null_count),
                            null_count: Some(null_count),
                            numeric_statistics,
                            numeric_bins,
                            numeric_raw,
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
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub statistics: NumericStatistics,
    pub bins: Option<Vec<NumericBin>>,
    pub raw: Vec<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub enum TemporalSubType {
    Date,
    Datetime,
    Time,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemporalSummary {
    pub column_name: String,
    pub sub_type: TemporalSubType,
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
pub struct CsvOption {
    pub separator: Option<char>,
}

#[derive(Debug, PartialEq, Clone)]
pub enum InputTarget<'a> {
    StdIn,
    FilePath(&'a Path),
}

impl<'a> InputTarget<'a> {
    pub fn generate_reader(&'a self) -> Result<Box<dyn MmapBytesReader>> {
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

#[derive(Debug, PartialEq, Clone)]
pub enum ReadDataKind<'a> {
    Csv(InputTarget<'a>, CsvOption),
    Json(InputTarget<'a>),
    JsonLine(InputTarget<'a>),
    Parquet(&'a Path),
}

impl<'a> ReadDataKind<'a> {
    pub fn from_path(path: &'a Path, csv_separator: Option<char>) -> Self {
        let target = InputTarget::FilePath(path);
        let extension = path.extension().and_then(|s| s.to_str());
        match extension {
            Some("tsv") => ReadDataKind::Csv(
                target,
                CsvOption {
                    separator: Some(csv_separator.unwrap_or('\t')),
                },
            ),
            Some("json") => ReadDataKind::Json(target),
            Some("jsonl") => ReadDataKind::JsonLine(target),
            Some("parquet") => ReadDataKind::Parquet(path),
            _ => ReadDataKind::Csv(
                target,
                CsvOption {
                    separator: csv_separator,
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
