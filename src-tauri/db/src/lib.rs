use anyhow::{Context, Result, bail};
use duckdb::Connection;
use duckdb::arrow::record_batch::RecordBatch;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

mod duckdb_data_type;
use duckdb_data_type::DuckDBType;

#[derive(Debug, Clone)]
pub enum ReadDataType {
    Csv,
    Parquet,
    Json,
    Text,
    Blob,
    Xlsx,
}

impl ReadDataType {
    pub fn to_read_fn_str(&self) -> &str {
        match self {
            ReadDataType::Csv => "read_csv",
            ReadDataType::Parquet => "read_parquet",
            ReadDataType::Json => "read_json",
            ReadDataType::Text => "read_text",
            ReadDataType::Blob => "read_blob",
            ReadDataType::Xlsx => "read_xlsx",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub column_name: String,
    pub column_type: DuckDBType,
}

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
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub statistics: NumericStatistics,
    pub bins: Option<Vec<NumericBin>>,
    pub raw: Vec<f64>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StringSummary {
    pub column_name: String,
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
    pub column_name: String,
    pub not_null_count: Option<usize>,
    pub null_count: Option<usize>,
    pub value_counts: Option<Vec<ValueCount<bool>>>,
}

pub struct DbState {
    pub conn: Connection,
    pub table: Option<String>,
}

impl DbState {
    pub fn try_new(db_path: Option<&str>) -> Result<Self> {
        let conn = if let Some(path) = db_path {
            Connection::open(path)?
        } else {
            Connection::open_in_memory()?
        };
        Ok(DbState { conn, table: None })
    }

    pub fn register_data(
        &mut self,
        file_path: &Path,
        table_name: &str,
        data_type: ReadDataType,
        options: HashMap<&str, &str>,
    ) -> Result<()> {
        let file_path_str = file_path.to_str().ok_or_else(|| {
            anyhow::anyhow!("Failed to convert file path to string: {:?}", file_path)
        })?;
        let read_fn = data_type.to_read_fn_str();
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

        let sql = format!(
            "CREATE TABLE {table_name} AS SELECT * FROM {read_fn}('{file_path_str}'{options_str});"
        );

        self.conn.execute(&sql, [])?;

        self.table = Some(table_name.to_string());

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

    pub fn get_columns_schema(&self, table_name: &str) -> Result<Vec<ColumnInfo>> {
        let sql = format!(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table_name}';"
        );

        let schema = self
            .conn
            .prepare(&sql)?
            .query_map([], |row| {
                Ok(ColumnInfo {
                    column_name: row.get(0)?,
                    column_type: row.get(1)?,
                })
            })?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(schema)
    }

    pub fn execute(&self, sql: &str) -> Result<Vec<Map<String, Value>>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rbs: Vec<RecordBatch> = stmt.query_arrow([])?.collect();

        let rbs_refs: Vec<&RecordBatch> = rbs.iter().collect();
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

    pub fn extract_table(&self, table_name: &str) -> Result<Vec<Map<String, Value>>> {
        let sql = format!("SELECT * FROM {};", table_name);
        self.execute(&sql)
    }

    pub fn execute_with_save(
        &self,
        sql: &str,
        table_name: &str,
    ) -> Result<Vec<Map<String, Value>>> {
        let sql_with_create = format!(
            r"CREATE OR REPLACE TEMP TABLE {table_name} AS FROM ({})",
            sql.trim_end().trim_end_matches(';')
        );

        self.conn.execute(&sql_with_create, [])?;
        self.extract_table(table_name)
    }

    pub fn binning(
        &self,
        table_name: &str,
        col_name: &str,
        bin_size: Option<u32>,
    ) -> Result<Vec<NumericBin>> {
        let bin_size_str = bin_size.map_or_else(
            || format!("CEIL(LOG2(count({col_name})) + 1)"),
            |bw| bw.to_string(),
        );

        let query = format!(
            r"
                WITH
                stats AS (
                    SELECT
                        min({col_name}) AS min_value,
                        max({col_name}) AS max_value,
                        CAST({bin_size_str} AS BIGINT) AS bin_size
                    FROM {table_name}
                ),

                hist_bins AS (
                    SELECT
                        unnest(
                            map_entries(
                                histogram(
                                    {col_name},
                                    equi_width_bins(
                                        (SELECT min_value FROM stats),
                                        (SELECT max_value FROM stats),
                                        (SELECT bin_size FROM stats),
                                        false
                                    )
                                ))) AS bins
                    FROM {table_name}
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
            .prepare(&query)?
            .query_map([], |row| {
                Ok(NumericBin {
                    lower: row.get(0)?,
                    upper: row.get(1)?,
                    count: row.get(2)?,
                })
            })?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(result)
    }

    pub fn value_counts<T>(&self, table_name: &str, col_name: &str) -> Result<Vec<ValueCount<T>>>
    where
        T: duckdb::types::FromSql,
    {
        let query = format!(
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
            .prepare(&query)?
            .query_map([], |row| {
                Ok(ValueCount {
                    value: row.get(0)?,
                    count: row.get(1)?,
                    prop: row.get(2)?,
                })
            })?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(result)
    }

    pub fn numeric_summarise(&self, table_name: &str, col_name: &str) -> Result<NumericSummary> {
        let query = format!(
            r"
                WITH stats AS (
                    SELECT
                        COUNT({col_name}) AS not_null_count,
                        COUNTIF({col_name} IS NULL) AS null_count,
                        MIN({col_name}) AS min,
                        MAX({col_name}) AS max,
                        quantile_cont({col_name}, [.25, .5, .75]) as quantile,
                        AVG({col_name}) AS mean,
                        STDDEV_SAMP({col_name}) AS std
                    FROM {table_name}
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

        let mut statement = self.conn.prepare(&query)?;
        let mut rows = statement.query([])?;
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

        Ok(NumericSummary {
            column_name: col_name.to_string(),
            not_null_count,
            null_count,
            statistics,
            bins: Some(bins),
            raw: vec![], // TODO rawを削除してrust+duckdbでbinning処理を行うようにする
        })
    }

    pub fn string_summarise(&self, table_name: &str, col_name: &str) -> Result<StringSummary> {
        let query = format!(
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

        let mut statement = self.conn.prepare(&query)?;
        let mut rows = statement.query([])?;
        let first_row = rows.next()?.with_context(|| "query running failed.")?;

        let not_null_count: Option<usize> = first_row.get(0)?;
        let null_count: Option<usize> = first_row.get(1)?;
        let min_len: Option<usize> = first_row.get(2)?;
        let max_len: Option<usize> = first_row.get(3)?;
        let unique_count: Option<usize> = first_row.get(4)?;

        let value_counts = self.value_counts(table_name, col_name)?;

        Ok(StringSummary {
            column_name: col_name.to_string(),
            not_null_count,
            null_count,
            min_len,
            max_len,
            unique_count,
            value_counts: Some(value_counts),
        })
    }

    pub fn boolean_summarise(&self, table_name: &str, col_name: &str) -> Result<BooleanSummary> {
        let query = format!(
            r"
                SELECT
                    COUNT({col_name}) AS not_null_count,
                    COUNTIF({col_name} IS NULL) AS null_count
                FROM {table_name}
            "
        );

        let mut statement = self.conn.prepare(&query)?;
        let mut rows = statement.query([])?;
        let first_row = rows.next()?.with_context(|| "query running failed.")?;

        let not_null_count: Option<usize> = first_row.get(0)?;
        let null_count: Option<usize> = first_row.get(1)?;

        let value_counts = self.value_counts::<bool>(table_name, col_name)?;

        Ok(BooleanSummary {
            column_name: col_name.to_string(),
            not_null_count,
            null_count,
            value_counts: Some(value_counts),
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
            let query = format!(
                r"
                    ATTACH '{full_path}';
                    COPY FROM DATABASE (SELECT current_catalog()) TO {file_stem};
                    DETACH {file_stem};
                "
            );
            self.conn.execute_batch(&query)?;
        } else {
            bail!("invalid path {:?}", path);
        }

        Ok(())
    }
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
                "sample",
                ReadDataType::Csv,
                options,
            )
            .unwrap();

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
    }
}
