use anyhow::{Context, Result, anyhow, bail};
use duckdb::Connection;
use duckdb::arrow::record_batch::RecordBatch;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

pub mod duckdb_data_type;
use duckdb_data_type::{DtypeGroup, DuckDBType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ReadDataType {
    Csv,
    Parquet,
    Json,
    Text,
    Blob,
    Xlsx,
}

impl TryFrom<&str> for ReadDataType {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value.to_lowercase().as_str() {
            "csv" => Ok(ReadDataType::Csv),
            "parquet" => Ok(ReadDataType::Parquet),
            "json" | "jsonl" => Ok(ReadDataType::Json),
            "text" => Ok(ReadDataType::Text),
            "blob" => Ok(ReadDataType::Blob),
            "xlsx" => Ok(ReadDataType::Xlsx),
            _ => bail!("Unsupported read data type: {}", value),
        }
    }
}

impl ReadDataType {
    pub fn to_read_fn_str(&self) -> &str {
        match self {
            ReadDataType::Csv => "read_csv",
            ReadDataType::Parquet => "read_parquet",
            ReadDataType::Json => "read_json_auto",
            ReadDataType::Text => "read_text",
            ReadDataType::Blob => "read_blob",
            ReadDataType::Xlsx => "read_xlsx",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub column_name: String,
    pub column_type: DuckDBType,
    pub column_dtype_group: DtypeGroup,
}

pub type Schema = Vec<ColumnInfo>;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NumericBin {
    pub lower: f64,
    pub upper: f64,
    pub count: u32,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValueCount<T> {
    pub value: Option<T>,
    pub count: Option<u32>,
    pub prop: Option<f64>,
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
#[serde(rename_all = "camelCase")]
pub struct NumericSummary {
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub statistics: NumericStatistics,
    pub bins: Option<Vec<NumericBin>>,
    pub raw: Vec<Option<f64>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemporalSummary {
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub numeric_statistics: NumericStatistics,
    pub numeric_bins: Option<Vec<NumericBin>>,
    pub numeric_raw: Vec<Option<f64>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StringSummary {
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub min_len: Option<usize>,
    pub max_len: Option<usize>,
    pub unique_count: Option<usize>,
    pub value_counts: Option<Vec<ValueCount<String>>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BooleanSummary {
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub value_counts: Option<Vec<ValueCount<bool>>>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OtherSummary {
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ColumnSummary {
    #[serde(rename_all = "camelCase")]
    Numeric {
        column_name: String,
        summary: NumericSummary,
    },
    #[serde(rename_all = "camelCase")]
    Temporal {
        column_name: String,
        summary: TemporalSummary,
    },
    #[serde(rename_all = "camelCase")]
    String {
        column_name: String,
        summary: StringSummary,
    },
    #[serde(rename_all = "camelCase")]
    Boolean {
        column_name: String,
        summary: BooleanSummary,
    },
    #[serde(rename_all = "camelCase")]
    Other {
        column_name: String,
        summary: OtherSummary,
    },
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtractDataResult {
    pub name: String,
    pub df_json: String,
    pub schema: Schema,
    pub summary: TableSummary,
}

pub type TableSummary = Vec<ColumnSummary>;

pub struct DbState {
    conn: Connection,
}

pub struct QueryResult(Vec<RecordBatch>);

impl From<Vec<RecordBatch>> for QueryResult {
    fn from(rbs: Vec<RecordBatch>) -> Self {
        QueryResult(rbs)
    }
}

impl QueryResult {
    pub fn into_json(self) -> Result<Vec<Map<String, Value>>> {
        let rbs_refs: Vec<&RecordBatch> = self.0.iter().collect();
        let buf = Vec::new();
        let mut writer = arrow_json::WriterBuilder::new()
            .with_explicit_nulls(true)
            .build::<_, arrow_json::writer::JsonArray>(buf);
        writer.write_batches(rbs_refs.as_slice())?;
        writer.finish()?;

        let json_data = writer.into_inner();
        let result: Vec<Map<String, Value>> = serde_json::from_reader(json_data.as_slice())?;

        Ok(result)
    }
}

impl DbState {
    pub fn try_new(db_path: Option<&str>) -> Result<Self> {
        let conn = if let Some(path) = db_path {
            Connection::open(path)?
        } else {
            Connection::open_in_memory()?
        };
        Ok(DbState { conn })
    }

    pub fn register_data(
        &mut self,
        file_path: &Path,
        table_name: Option<&str>,
        data_type: Option<ReadDataType>,
        allow_replace: bool,
        options: HashMap<&str, &str>,
    ) -> Result<()> {
        let file_path_str = file_path
            .to_str()
            .ok_or_else(|| anyhow!("Failed to convert file path to string: {:?}", file_path))?;

        let read_fn = if let Some(data_type) = data_type {
            data_type.to_read_fn_str().to_string()
        } else {
            let extension = file_path
                .extension()
                .with_context(|| {
                    anyhow!(
                        "file extension is not specified for file: {}",
                        file_path_str
                    )
                })?
                .to_str()
                .with_context(|| {
                    anyhow!(
                        "file extension is not specified for file: {}",
                        file_path_str
                    )
                })?;

            ReadDataType::try_from(extension)?
                .to_read_fn_str()
                .to_string()
        };

        let options_str = if options.is_empty() {
            String::new()
        } else {
            ", ".to_string()
                + options
                    .iter()
                    .map(|(k, v)| format!("{} = {}", k, v))
                    .collect::<Vec<_>>()
                    .join(", ")
                    .as_str()
        };

        let statement = if allow_replace {
            "CREATE OR REPLACE"
        } else {
            "CREATE"
        };

        let table_name = if let Some(table_name) = table_name {
            table_name
        } else {
            file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow!("Failed to get file stem for file: {}", file_path_str))?
        };

        let sql = format!(
            "{statement} TABLE {table_name} AS SELECT * FROM {read_fn}('{file_path_str}'{options_str});"
        );

        self.conn
            .execute(&sql, [])
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?;

        Ok(())
    }

    pub fn get_table_names(&self) -> Result<Vec<String>> {
        let schema = self
            .conn
            .prepare(
                "SELECT table_name FROM information_schema.tables where table_catalog = current_catalog();",
            )?
            .query_map([], |row| {
                row.get(0)
            })?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(schema)
    }

    pub fn get_columns_schema(&self, table_name: &str) -> Result<Schema> {
        let sql = format!(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table_name}';"
        );

        let schema = self
            .conn
            .prepare(&sql)?
            .query_map([], |row| {
                let column_name: String = row.get(0)?;
                let column_type: DuckDBType = row.get(1)?;
                let column_dtype_group = DtypeGroup::from(column_type.clone());
                Ok(ColumnInfo {
                    column_name,
                    column_type,
                    column_dtype_group,
                })
            })
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(schema)
    }

    pub fn execute(&self, sql: &str) -> Result<QueryResult> {
        let mut stmt = self.conn.prepare(sql)?;
        let rbs: Vec<RecordBatch> = stmt
            .query_arrow([])
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?
            .collect();
        Ok(rbs.into())
    }

    pub fn extract_table(&self, table_name: &str) -> Result<Vec<Map<String, Value>>> {
        let sql = format!("SELECT * FROM {};", table_name);
        self.execute(&sql).and_then(|res| res.into_json())
    }

    pub fn execute_with_save(&self, sql: &str, table_name: &str) -> Result<QueryResult> {
        let sql_with_create = format!(
            r"CREATE OR REPLACE TEMP TABLE {table_name} AS FROM ({})",
            sql.trim_end().trim_end_matches(';')
        );

        self.execute(&sql_with_create)
    }

    pub fn binning(
        &self,
        table_name: &str,
        col_name: &str,
        bin_size: Option<u32>,
    ) -> Result<Vec<NumericBin>> {
        let bin_size = bin_size.map_or_else(
            || "CEIL(LOG2(count(target)) + 1)".to_string(),
            |bw| bw.to_string(),
        );

        let sql = format!(
            r"
                WITH
                base AS (
                    SELECT {col_name} AS target
                    FROM {table_name}
                ),

                stats AS (
                    SELECT
                        min(target) AS min_value,
                        max(target) AS max_value,
                        CAST({bin_size} AS BIGINT) AS bin_size
                    FROM base
                ),

                hist_bins AS (
                    SELECT
                        unnest(
                            map_entries(
                                histogram(
                                    target,
                                    equi_width_bins(
                                        (SELECT min_value FROM stats),
                                        (SELECT max_value FROM stats),
                                        (SELECT bin_size FROM stats),
                                        false
                                    )
                                ))) AS bins
                    FROM base
                ),

                with_lag AS (
                    SELECT
                        lag(bins.key) OVER (ORDER BY bins.key) AS lagged,
                        bins.key,
                        bins.value,
                        row_number() OVER (ORDER BY bins.key) AS rn
                    FROM hist_bins
                )

                SELECT
                    CASE
                        WHEN rn = 1 THEN (SELECT min_value FROM stats)
                        ELSE lagged
                    END AS lower,
                    key AS upper,
                    value AS count
                FROM with_lag;
        "
        );

        let result = self
            .conn
            .prepare(&sql)?
            .query_map([], |row| {
                Ok(NumericBin {
                    lower: row.get(0)?,
                    upper: row.get(1)?,
                    count: row.get(2)?,
                })
            })
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(result)
    }

    pub fn value_counts<T>(&self, table_name: &str, col_name: &str) -> Result<Vec<ValueCount<T>>>
    where
        T: duckdb::types::FromSql,
    {
        let sql = format!(
            r"
                SELECT 
                    {col_name},
                    COUNT(*) AS count,
                    COUNT(*) / (SELECT COUNT(*) FROM {table_name}) AS prop
                FROM {table_name}
                GROUP BY {col_name}
                ORDER BY count DESC;
            "
        );

        let result = self
            .conn
            .prepare(&sql)?
            .query_map([], |row| {
                Ok(ValueCount {
                    value: row.get(0)?,
                    count: row.get(1)?,
                    prop: row.get(2)?,
                })
            })
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(result)
    }

    pub fn extract_raw_column<T>(&self, table_name: &str, col_name: &str) -> Result<Vec<T>>
    where
        T: duckdb::types::FromSql,
    {
        let sql = format!(r"SELECT {col_name} FROM {table_name}");

        let result = self
            .conn
            .prepare(&sql)?
            .query_map([], |row| row.get(0))
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?
            .collect::<duckdb::Result<Vec<T>>>()?;

        Ok(result)
    }

    pub fn numeric_summarise(&self, table_name: &str, col_name: &str) -> Result<NumericSummary> {
        let sql = format!(
            r"
                WITH
                base AS (
                    SELECT {col_name} AS target
                    FROM {table_name}
                ),

                stats AS (
                    SELECT
                        COUNT(target) AS not_null_count,
                        COUNTIF(target IS NULL) AS null_count,
                        MIN(target) AS min,
                        MAX(target) AS max,
                        quantile_cont(target, [.25, .5, .75]) as quantile,
                        AVG(target) AS mean,
                        STDDEV_SAMP(target) AS std
                    FROM base
                )

                SELECT 
                    not_null_count,
                    null_count,
                    min,
                    quantile[1] AS q1,
                    quantile[2] AS median,
                    quantile[3] AS q3,
                    max,
                    mean,
                    std
                FROM stats
            "
        );

        let mut statement = self.conn.prepare(&sql)?;
        let mut rows = statement
            .query([])
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?;
        let first_row = rows.next()?.with_context(|| "query running failed.")?;

        let not_null_count: Option<usize> = first_row.get(0)?;
        let null_count: Option<usize> = first_row.get(1)?;
        let min: Option<f64> = first_row.get(2)?;
        let q1: Option<f64> = first_row.get(3)?;
        let median: Option<f64> = first_row.get(4)?;
        let q3: Option<f64> = first_row.get(5)?;
        let max: Option<f64> = first_row.get(6)?;
        let mean: Option<f64> = first_row.get(7)?;
        let std: Option<f64> = first_row.get(8)?;

        let statistics = NumericStatistics {
            min,
            q1,
            median,
            q3,
            max,
            mean,
            std,
        };

        let bins = self.binning(table_name, col_name, None)?;

        let raw = self.extract_raw_column(table_name, col_name)?;

        Ok(NumericSummary {
            not_null_count,
            null_count,
            statistics,
            bins: Some(bins),
            raw,
        })
    }

    pub fn temporal_summarise(&self, table_name: &str, col_name: &str) -> Result<TemporalSummary> {
        let col_transform = format!("epoch_ms({col_name})");
        let result = self.numeric_summarise(table_name, &col_transform)?;

        Ok(TemporalSummary {
            not_null_count: result.not_null_count,
            null_count: result.null_count,
            numeric_statistics: result.statistics,
            numeric_bins: result.bins,
            numeric_raw: result.raw,
        })
    }

    pub fn string_summarise(&self, table_name: &str, col_name: &str) -> Result<StringSummary> {
        let sql = format!(
            r"
                SELECT
                    COUNT({col_name}) AS not_null_count,
                    COUNTIF({col_name} IS NULL) AS null_count,
                    MIN(LEN({col_name})) AS min_len,
                    MAX(LEN({col_name})) AS max_len,
                    COUNT(DISTINCT {col_name}) AS unique_count
                FROM {table_name}
            "
        );

        let mut statement = self.conn.prepare(&sql)?;
        let mut rows = statement
            .query([])
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?;
        let first_row = rows.next()?.with_context(|| "query running failed.")?;

        let not_null_count: Option<usize> = first_row.get(0)?;
        let null_count: Option<usize> = first_row.get(1)?;
        let min_len: Option<usize> = first_row.get(2)?;
        let max_len: Option<usize> = first_row.get(3)?;
        let unique_count: Option<usize> = first_row.get(4)?;

        let value_counts = self.value_counts(table_name, col_name)?;

        Ok(StringSummary {
            not_null_count,
            null_count,
            min_len,
            max_len,
            unique_count,
            value_counts: Some(value_counts),
        })
    }

    pub fn boolean_summarise(&self, table_name: &str, col_name: &str) -> Result<BooleanSummary> {
        let sql = format!(
            r"
                SELECT
                    COUNT({col_name}) AS not_null_count,
                    COUNTIF({col_name} IS NULL) AS null_count
                FROM {table_name}
            "
        );

        let mut statement = self.conn.prepare(&sql)?;
        let mut rows = statement
            .query([])
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?;
        let first_row = rows.next()?.with_context(|| "query running failed.")?;

        let not_null_count: Option<usize> = first_row.get(0)?;
        let null_count: Option<usize> = first_row.get(1)?;

        let value_counts = self.value_counts::<bool>(table_name, col_name)?;

        Ok(BooleanSummary {
            not_null_count,
            null_count,
            value_counts: Some(value_counts),
        })
    }

    pub fn other_summarise(&self, table_name: &str, col_name: &str) -> Result<OtherSummary> {
        let sql = format!(
            r"
                SELECT
                    COUNT({col_name}) AS not_null_count,
                    COUNTIF({col_name} IS NULL) AS null_count
                FROM {table_name}
            "
        );

        let mut statement = self.conn.prepare(&sql)?;
        let mut rows = statement
            .query([])
            .with_context(|| "An error occurred while executing the following query.\n{sql}")?;
        let first_row = rows.next()?.with_context(|| "query running failed.")?;

        let not_null_count: Option<usize> = first_row.get(0)?;
        let null_count: Option<usize> = first_row.get(1)?;

        Ok(OtherSummary {
            not_null_count,
            null_count,
        })
    }

    pub fn save_database(&self, path: &Path) -> Result<()> {
        if self.conn.path() != Some(Path::new(":memory:")) {
            bail!("The database can only be saved when opened in in-memory mode.");
        }

        if path.exists() {
            bail!("{} is already exists.", path.display());
        }

        if let (Some(full_path), Some(file_stem)) =
            (path.to_str(), path.file_stem().and_then(|s| s.to_str()))
        {
            // memoryかどうかをチェックする
            let sql = format!(
                r"
                    ATTACH '{full_path}';
                    COPY FROM DATABASE (SELECT current_catalog()) TO {file_stem};
                    DETACH {file_stem};
                "
            );
            self.conn
                .execute_batch(&sql)
                .with_context(|| "An error occurred while executing the following query.\n{sql}")?;
        } else {
            bail!("invalid path {:?}", path);
        }

        Ok(())
    }
}

pub fn escape_sql_identifier(input: &str) -> String {
    let quoted = input.starts_with('"') && input.ends_with('"');

    let mut result = String::new();

    result.push('"');

    for (i, c) in input.chars().enumerate() {
        if quoted && (i == 0 || i == input.len() - 1) {
            continue;
        }

        if c == '"' {
            result.push('"'); // ダブルクオートをエスケープ
        }

        result.push(c);
    }

    result.push('"');

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let mut db_state = DbState::try_new(None).unwrap();

        let mut options = HashMap::new();
        options.insert("types", "{'列3': 'VARCHAR', '列4': 'BOOLEAN'}");

        db_state
            .register_data(
                Path::new("~/Development/data_viewer/sample.csv"),
                None,
                None,
                false,
                options,
            )
            .unwrap();

        assert!(
            db_state
                .register_data(
                    Path::new("~/Development/data_viewer/sample.csv"),
                    None,
                    None,
                    false,
                    HashMap::new()
                )
                .is_err()
        );

        assert!(
            db_state
                .register_data(
                    Path::new("~/Development/data_viewer/sample.csv"),
                    None,
                    None,
                    true,
                    HashMap::new()
                )
                .is_ok()
        );

        println!("get_table_names: {:?}", db_state.get_table_names());

        assert!(
            db_state
                .get_table_names()
                .unwrap()
                .contains(&"sample".to_string())
        );

        println!(
            "get_columns_schema: {:?}",
            db_state.get_columns_schema("sample")
        );
        println!("extract_table: {:?}", db_state.extract_table("sample"));
        println!(
            "value_counts(列1): {:?}",
            db_state.value_counts::<String>("sample", "列1")
        );
        println!("binning(id): {:?}", db_state.binning("sample", "id", None));

        println!(
            "boolean_summarise(列4): {:?}",
            db_state.boolean_summarise("sample", "列4")
        );

        assert!(db_state.execute("SELECT * FROM sample").is_ok());
        assert!(
            db_state
                .execute_with_save(
                    "with temp AS (SELECT COUNT(*) AS cnt FROM sample) select * from temp;",
                    "_last"
                )
                .is_ok()
        );

        assert!(
            db_state
                .execute("SELECT cnt + 1 AS cnt_plus_one FROM _last")
                .is_ok()
        );

        assert!(
            db_state
                .execute_with_save("create table ews_sample as select * from sample;", "_last")
                .is_err()
        );

        assert!(
            db_state
                .execute("create table ews_sample as select * from sample;")
                .is_ok()
        );

        let mut temporal_sample_read_options = HashMap::new();
        temporal_sample_read_options.insert(
            "types",
            "{'date':'date', 'datetime_naive':'timestamp', 'datetimetz_utc':'timestamptz', 'datetimetz_jp': 'timestamptz', 'datetimetz_us':'timestamptz', 'time':'timetz'}",
        );

        db_state
            .register_data(
                Path::new("~/Development/data_viewer/temporal_sample.csv"),
                None,
                None,
                false,
                temporal_sample_read_options,
            )
            .unwrap();

        assert!(
            db_state
                .temporal_summarise("temporal_sample", "date")
                .is_ok()
        );

        assert!(
            db_state
                .temporal_summarise("temporal_sample", "datetime_naive")
                .is_ok()
        );

        assert!(
            db_state
                .temporal_summarise("temporal_sample", "datetimetz_utc")
                .is_ok()
        );

        assert!(
            db_state
                .temporal_summarise("temporal_sample", "time")
                .is_ok()
        );
    }

    #[test]
    fn escape_sql_identifier_test() {
        assert_eq!(escape_sql_identifier("sample_col"), "\"sample_col\"");
        assert_eq!(escape_sql_identifier("sample\"col"), "\"sample\"\"col\"");
        assert_eq!(escape_sql_identifier("\"sample_col\""), "\"sample_col\"");
        assert_eq!(escape_sql_identifier("\"sample_col"), "\"\"\"sample_col\"");
        assert_eq!(escape_sql_identifier("sample_col\""), "\"sample_col\"\"\"");
        assert_eq!(
            escape_sql_identifier("\"\"sample\"col\"\""),
            "\"\"\"sample\"\"col\"\"\""
        );
        assert_eq!(
            escape_sql_identifier("\"\"sample\"col\"\""),
            "\"\"\"sample\"\"col\"\"\""
        );
    }
}
