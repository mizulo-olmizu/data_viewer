use anyhow::Result;
use duckdb::Connection;
use duckdb::arrow::record_batch::RecordBatch;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

mod duckdb_data_type;

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
    pub column_type: String,
}

#[derive(Debug, Clone)]
pub struct Bin {
    pub bin_index: i32,
    pub count: i32,
    pub lower: f64,
    pub upper: f64,
}

#[derive(Debug, Clone)]
pub struct ValueCount {
    pub value: Option<String>,
    pub count: i32,
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
        let options_str = options
            .iter()
            .map(|(k, v)| format!("{} = {}", k, v))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "CREATE TABLE {table_name} AS SELECT * FROM {read_fn}('{file_path_str}', {options_str});"
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

    pub fn binning(&self, table_name: &str, col_name: &str) -> Result<Vec<Bin>> {
        let query = format!(
            r"
                WITH stats AS (
                SELECT
                    COUNT(*) AS n,
                    MIN({col_name}) AS min_val,
                    MAX({col_name}) AS max_val
                FROM {table_name}
                ),

                bin_params AS (
                SELECT
                    CEIL(LOG2(n) + 1) AS k,
                    min_val,
                    max_val,
                    (max_val - min_val) / CEIL(LOG2(n) + 1) AS bin_width
                FROM stats
                ),

                binned AS (
                SELECT
                    *,
                    bin_params.k,
                    bin_params.min_val,
                    bin_params.bin_width,
                    FLOOR(({col_name} - bin_params.min_val) / bin_params.bin_width) AS bin_index
                FROM {table_name}, bin_params
                ),

                final_bins AS (
                SELECT
                    bin_index,
                    COUNT(*) AS count,
                    min_val + bin_index * bin_width AS lower,
                    min_val + (bin_index + 1) * bin_width AS upper
                FROM binned
                GROUP BY bin_index, min_val, bin_width
                )

                SELECT * FROM final_bins
                ORDER BY bin_index;
        "
        );

        let result = self
            .conn
            .prepare(&query)?
            .query_map([], |row| {
                Ok(Bin {
                    bin_index: row.get(0)?,
                    count: row.get(1)?,
                    lower: row.get(2)?,
                    upper: row.get(3)?,
                })
            })?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(result)
    }

    pub fn value_counts(&self, table_name: &str, col_name: &str) -> Result<Vec<ValueCount>> {
        let query = format!(
            r"
                SELECT {col_name}, COUNT(*) AS count
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
                })
            })?
            .collect::<duckdb::Result<Vec<_>>>()?;

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let mut db_state = DbState::try_new(None).unwrap();

        let mut options = HashMap::new();
        options.insert("types", "{'列3': 'VARCHAR'}");

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
            db_state.value_counts("sample", "列1")
        );
        println!("binning(id): {:?}", db_state.binning("sample", "id"));

        assert!(db_state.execute("SELECT * FROM sample").is_ok());
    }
}
