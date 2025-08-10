use duckdb::types::FromSql;
use pest::Parser;
use pest::iterators::Pair;
use pest_derive::Parser;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, PartialEq, Clone)]
pub enum DuckDBType {
    BigInt,
    Bit,
    Blob,
    Boolean,
    Date,
    Decimal(Option<(u8, u8)>),
    Double,
    Float,
    HugeInt,
    Integer,
    Interval,
    Json,
    SmallInt,
    Time,
    TimestampWithTimeZone,
    Timestamp,
    TinyInt,
    UBigInt,
    UHugeInt,
    UInteger,
    USmallInt,
    UTinyInt,
    Uuid,
    Varchar,

    Array(Box<DuckDBType>, usize),
    List(Box<DuckDBType>),
    Map(Box<DuckDBType>, Box<DuckDBType>),
    Struct(Vec<StructField>),
    Union(Vec<StructField>),

    Unknown(String),
}

#[derive(Debug, PartialEq, Clone)]
pub struct StructField {
    pub name: String,
    pub typ: DuckDBType,
}

#[derive(Parser)]
#[grammar = "./duckdb_type.pest"] // ファイル名に合わせる
pub struct DuckTypeParser;

impl From<&str> for DuckDBType {
    fn from(s: &str) -> Self {
        s.parse().unwrap_or(DuckDBType::Unknown(s.to_string()))
    }
}

impl FromSql for DuckDBType {
    fn column_result(value: duckdb::types::ValueRef<'_>) -> duckdb::types::FromSqlResult<Self> {
        String::column_result(value).map(|s| DuckDBType::from(s.as_str()))
    }
}

impl FromStr for DuckDBType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim(); // 余計な前後の空白除去
        let pairs =
            DuckTypeParser::parse(Rule::duck_type, s).map_err(|e| format!("parse error: {}", e))?;

        let pair = pairs
            .into_iter()
            .next()
            .ok_or("expected one rule".to_string())?;

        Ok(build_type(pair))
    }
}

fn build_type(pair: Pair<Rule>) -> DuckDBType {
    let pair = if pair.as_rule() == Rule::duck_type {
        pair.into_inner().next().unwrap()
    } else {
        pair
    };

    match pair.as_rule() {
        Rule::postfix_type => {
            let mut inner = pair.into_inner();
            let mut typ = build_type(inner.next().unwrap());

            for modifier in inner {
                match modifier.as_rule() {
                    Rule::array_modifier => {
                        let len = modifier.into_inner().as_str().parse().unwrap();
                        typ = DuckDBType::Array(Box::new(typ), len);
                    }
                    Rule::list_modifier => {
                        typ = DuckDBType::List(Box::new(typ));
                    }
                    _ => unreachable!(),
                }
            }

            typ
        }

        Rule::primary_type => build_type(pair.into_inner().next().unwrap()),

        Rule::map_type => {
            let mut inner = pair.into_inner();
            let key = build_type(inner.next().unwrap());
            let val = build_type(inner.next().unwrap());
            DuckDBType::Map(Box::new(key), Box::new(val))
        }

        Rule::struct_type => {
            let fields = build_fields(pair.into_inner().next().unwrap());
            DuckDBType::Struct(fields)
        }

        Rule::union_type => {
            let fields = build_fields(pair.into_inner().next().unwrap());
            DuckDBType::Union(fields)
        }

        Rule::decimal_type => {
            let mut inner = pair.into_inner();
            if let (Some(p), Some(s)) = (inner.next(), inner.next()) {
                DuckDBType::Decimal(Some((
                    p.as_str().parse().unwrap(),
                    s.as_str().parse().unwrap(),
                )))
            } else {
                DuckDBType::Decimal(None)
            }
        }

        Rule::base_type => match pair.as_str().to_uppercase().as_str() {
            "BIGINT" | "INT8" | "LONG" => DuckDBType::BigInt,
            "BIT" | "BITSTRING" => DuckDBType::Bit,
            "BLOB" | "BYTEA" | "BINARY" | "VARBINARY" => DuckDBType::Blob,
            "BOOLEAN" | "BOOL" | "LOGICAL" => DuckDBType::Boolean,
            "DATE" => DuckDBType::Date,
            "DOUBLE" | "FLOAT8" => DuckDBType::Double,
            "FLOAT" | "FLOAT4" | "REAL" => DuckDBType::Float,
            "HUGEINT" => DuckDBType::HugeInt,
            "INTEGER" | "INT4" | "INT" | "SIGNED" => DuckDBType::Integer,
            "INTERVAL" => DuckDBType::Interval,
            "JSON" => DuckDBType::Json,
            "SMALLINT" | "INT2" | "SHORT" => DuckDBType::SmallInt,
            "TIME" => DuckDBType::Time,
            "TIMESTAMP WITH TIME ZONE" | "TIMESTAMPTZ" => DuckDBType::TimestampWithTimeZone,
            "TIMESTAMP" | "DATETIME" => DuckDBType::Timestamp,
            "TINYINT" | "INT1" => DuckDBType::TinyInt,
            "UBIGINT" => DuckDBType::UBigInt,
            "UHUGEINT" => DuckDBType::UHugeInt,
            "UINTEGER" => DuckDBType::UInteger,
            "USMALLINT" => DuckDBType::USmallInt,
            "UTINYINT" => DuckDBType::UTinyInt,
            "UUID" => DuckDBType::Uuid,
            "VARCHAR" | "CHAR" | "BPCHAR" | "TEXT" | "STRING" => DuckDBType::Varchar,
            _ => DuckDBType::Unknown(pair.as_str().to_string()),
        },
        _ => DuckDBType::Unknown(pair.as_str().to_string()),
    }
}

fn build_fields(list: Pair<Rule>) -> Vec<StructField> {
    list.into_inner()
        .map(|field| {
            let mut inner = field.into_inner();
            let name = inner.next().unwrap().as_str().to_string();
            let typ = build_type(inner.next().unwrap());
            StructField { name, typ }
        })
        .collect()
}

impl fmt::Display for DuckDBType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // normal types
            DuckDBType::BigInt => write!(f, "BIGINT"),
            DuckDBType::Bit => write!(f, "BIT"),
            DuckDBType::Blob => write!(f, "BLOB"),
            DuckDBType::Boolean => write!(f, "BOOLEAN"),
            DuckDBType::Date => write!(f, "DATE"),
            DuckDBType::Decimal(None) => write!(f, "DECIMAL"),
            DuckDBType::Decimal(Some((p, s))) => write!(f, "DECIMAL({},{})", p, s),
            DuckDBType::Double => write!(f, "DOUBLE"),
            DuckDBType::Float => write!(f, "FLOAT"),
            DuckDBType::HugeInt => write!(f, "HUGEINT"),
            DuckDBType::Integer => write!(f, "INTEGER"),
            DuckDBType::Interval => write!(f, "INTERVAL"),
            DuckDBType::Json => write!(f, "JSON"),
            DuckDBType::SmallInt => write!(f, "SMALLINT"),
            DuckDBType::Time => write!(f, "TIME"),
            DuckDBType::TimestampWithTimeZone => write!(f, "TIMESTAMP WITH TIME ZONE"),
            DuckDBType::Timestamp => write!(f, "TIMESTAMP"),
            DuckDBType::TinyInt => write!(f, "TINYINT"),
            DuckDBType::UBigInt => write!(f, "UBIGINT"),
            DuckDBType::UHugeInt => write!(f, "UHUGEINT"),
            DuckDBType::UInteger => write!(f, "UINTEGER"),
            DuckDBType::USmallInt => write!(f, "USMALLINT"),
            DuckDBType::UTinyInt => write!(f, "UTINYINT"),
            DuckDBType::Uuid => write!(f, "UUID"),
            DuckDBType::Varchar => write!(f, "VARCHAR"),

            // nested types
            DuckDBType::Array(inner, size) => write!(f, "{}[{}]", inner, size),
            DuckDBType::List(inner) => write!(f, "{}[]", inner),
            DuckDBType::Map(key, value) => write!(f, "MAP({}, {})", key, value),
            DuckDBType::Struct(fields) => {
                let inner = fields
                    .iter()
                    .map(|StructField { name, typ }| format!("{} {}", name, typ))
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(f, "STRUCT({})", inner)
            }
            DuckDBType::Union(fields) => {
                let inner = fields
                    .iter()
                    .map(|StructField { name, typ }| format!("{} {}", name, typ))
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(f, "UNION({})", inner)
            }
            DuckDBType::Unknown(s) => write!(f, "{}", s),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum DtypeGroup {
    Numeric,
    Temporal,
    Duration,
    String,
    Boolean,
    Nested,
    Other,
}

impl From<DuckDBType> for DtypeGroup {
    fn from(typ: DuckDBType) -> Self {
        match typ {
            DuckDBType::BigInt
            | DuckDBType::Decimal(_)
            | DuckDBType::Double
            | DuckDBType::Float
            | DuckDBType::HugeInt
            | DuckDBType::Integer
            | DuckDBType::SmallInt
            | DuckDBType::TinyInt
            | DuckDBType::UBigInt
            | DuckDBType::UHugeInt
            | DuckDBType::UInteger
            | DuckDBType::USmallInt
            | DuckDBType::UTinyInt => DtypeGroup::Numeric,

            DuckDBType::Date
            | DuckDBType::Time
            | DuckDBType::TimestampWithTimeZone
            | DuckDBType::Timestamp => DtypeGroup::Temporal,

            DuckDBType::Interval => DtypeGroup::Duration,

            DuckDBType::Bit | DuckDBType::Json | DuckDBType::Uuid | DuckDBType::Varchar => {
                DtypeGroup::String
            }

            DuckDBType::Boolean => DtypeGroup::Boolean,

            DuckDBType::Array(_, _)
            | DuckDBType::List(_)
            | DuckDBType::Map(_, _)
            | DuckDBType::Struct(_)
            | DuckDBType::Union(_) => DtypeGroup::Nested,

            DuckDBType::Blob | DuckDBType::Unknown(_) => DtypeGroup::Other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_type_from_test() {
        assert_eq!(DuckDBType::from("BIGINT"), DuckDBType::BigInt);
        assert_eq!(DuckDBType::from("INT8"), DuckDBType::BigInt);
        assert_eq!(DuckDBType::from("LONG"), DuckDBType::BigInt);

        assert_eq!(DuckDBType::from("BIT"), DuckDBType::Bit);
        assert_eq!(DuckDBType::from("BITSTRING"), DuckDBType::Bit);

        assert_eq!(DuckDBType::from("BLOB"), DuckDBType::Blob);
        assert_eq!(DuckDBType::from("BYTEA"), DuckDBType::Blob);
        assert_eq!(DuckDBType::from("BINARY"), DuckDBType::Blob);
        assert_eq!(DuckDBType::from("VARBINARY"), DuckDBType::Blob);

        assert_eq!(DuckDBType::from("BOOLEAN"), DuckDBType::Boolean);
        assert_eq!(DuckDBType::from("BOOL"), DuckDBType::Boolean);
        assert_eq!(DuckDBType::from("LOGICAL"), DuckDBType::Boolean);

        assert_eq!(DuckDBType::from("DATE"), DuckDBType::Date);

        assert_eq!(
            DuckDBType::from("DECIMAL(18,3)"),
            DuckDBType::Decimal(Some((18, 3)))
        );

        assert_eq!(
            DuckDBType::from("NUMERIC(10,2)"),
            DuckDBType::Decimal(Some((10, 2)))
        );

        assert_eq!(DuckDBType::from("DOUBLE"), DuckDBType::Double);
        assert_eq!(DuckDBType::from("FLOAT8"), DuckDBType::Double);

        assert_eq!(DuckDBType::from("FLOAT"), DuckDBType::Float);
        assert_eq!(DuckDBType::from("FLOAT4"), DuckDBType::Float);
        assert_eq!(DuckDBType::from("REAL"), DuckDBType::Float);

        assert_eq!(DuckDBType::from("HUGEINT"), DuckDBType::HugeInt);

        assert_eq!(DuckDBType::from("INTEGER"), DuckDBType::Integer);
        assert_eq!(DuckDBType::from("INT4"), DuckDBType::Integer);
        assert_eq!(DuckDBType::from("INT"), DuckDBType::Integer);
        assert_eq!(DuckDBType::from("SIGNED"), DuckDBType::Integer);

        assert_eq!(DuckDBType::from("INTERVAL"), DuckDBType::Interval);

        assert_eq!(DuckDBType::from("JSON"), DuckDBType::Json);

        assert_eq!(DuckDBType::from("SMALLINT"), DuckDBType::SmallInt);
        assert_eq!(DuckDBType::from("INT2"), DuckDBType::SmallInt);
        assert_eq!(DuckDBType::from("SHORT"), DuckDBType::SmallInt);

        assert_eq!(DuckDBType::from("TIME"), DuckDBType::Time);

        assert_eq!(
            DuckDBType::from("TIMESTAMP WITH TIME ZONE"),
            DuckDBType::TimestampWithTimeZone
        );
        assert_eq!(
            DuckDBType::from("TIMESTAMPTZ"),
            DuckDBType::TimestampWithTimeZone
        );

        assert_eq!(DuckDBType::from("TIMESTAMP"), DuckDBType::Timestamp);
        assert_eq!(DuckDBType::from("DATETIME"), DuckDBType::Timestamp);

        assert_eq!(DuckDBType::from("TINYINT"), DuckDBType::TinyInt);
        assert_eq!(DuckDBType::from("INT1"), DuckDBType::TinyInt);

        assert_eq!(DuckDBType::from("UBIGINT"), DuckDBType::UBigInt);
        assert_eq!(DuckDBType::from("UHUGEINT"), DuckDBType::UHugeInt);
        assert_eq!(DuckDBType::from("UINTEGER"), DuckDBType::UInteger);
        assert_eq!(DuckDBType::from("USMALLINT"), DuckDBType::USmallInt);
        assert_eq!(DuckDBType::from("UTINYINT"), DuckDBType::UTinyInt);
        assert_eq!(DuckDBType::from("UUID"), DuckDBType::Uuid);

        assert_eq!(DuckDBType::from("VARCHAR"), DuckDBType::Varchar);
        assert_eq!(DuckDBType::from("CHAR"), DuckDBType::Varchar);
        assert_eq!(DuckDBType::from("BPCHAR"), DuckDBType::Varchar);
        assert_eq!(DuckDBType::from("TEXT"), DuckDBType::Varchar);
        assert_eq!(DuckDBType::from("STRING"), DuckDBType::Varchar);
    }

    #[test]
    fn nested_type_from_test() {
        assert_eq!(
            DuckDBType::from("INTEGER[3]"),
            DuckDBType::Array(Box::new(DuckDBType::Integer), 3)
        );

        assert_eq!(
            DuckDBType::from("INTEGER[]"),
            DuckDBType::List(Box::new(DuckDBType::Integer))
        );

        assert_eq!(
            DuckDBType::from("MAP(INTEGER, VARCHAR)"),
            DuckDBType::Map(Box::new(DuckDBType::Integer), Box::new(DuckDBType::Varchar))
        );

        assert_eq!(
            DuckDBType::from("STRUCT(num INTEGER, str VARCHAR)"),
            DuckDBType::Struct(vec![
                StructField {
                    name: "num".to_string(),
                    typ: DuckDBType::Integer
                },
                StructField {
                    name: "str".to_string(),
                    typ: DuckDBType::Varchar
                },
            ])
        );

        assert_eq!(
            DuckDBType::from("UNION(num INTEGER, \"text\" VARCHAR)"),
            DuckDBType::Union(vec![
                StructField {
                    name: "num".to_string(),
                    typ: DuckDBType::Integer
                },
                StructField {
                    name: "\"text\"".to_string(),
                    typ: DuckDBType::Varchar
                },
            ])
        );

        // complex types
        assert_eq!(
            DuckDBType::from("STRUCT(birds VARCHAR[], aliens INTEGER, amphibians VARCHAR[])"),
            DuckDBType::Struct(vec![
                StructField {
                    name: "birds".to_string(),
                    typ: DuckDBType::List(Box::new(DuckDBType::Varchar))
                },
                StructField {
                    name: "aliens".to_string(),
                    typ: DuckDBType::Integer
                },
                StructField {
                    name: "amphibians".to_string(),
                    typ: DuckDBType::List(Box::new(DuckDBType::Varchar))
                },
            ])
        );

        assert_eq!(
            DuckDBType::from("STRUCT(test MAP(INTEGER, DECIMAL(11,1))[])"),
            DuckDBType::Struct(vec![StructField {
                name: "test".to_string(),
                typ: DuckDBType::List(Box::new(DuckDBType::Map(
                    Box::new(DuckDBType::Integer),
                    Box::new(DuckDBType::Decimal(Some((11, 1))))
                )))
            },])
        );

        assert_eq!(
            DuckDBType::from("UNION(str VARCHAR, num INTEGER)[]"),
            DuckDBType::List(Box::new(DuckDBType::Union(vec![
                StructField {
                    name: "str".to_string(),
                    typ: DuckDBType::Varchar
                },
                StructField {
                    name: "num".to_string(),
                    typ: DuckDBType::Integer
                },
            ])))
        );
    }

    #[test]
    fn normal_type_to_string_test() {
        assert_eq!(DuckDBType::BigInt.to_string(), String::from("BIGINT"));
        assert_eq!(DuckDBType::Bit.to_string(), String::from("BIT"));
        assert_eq!(DuckDBType::Blob.to_string(), String::from("BLOB"));
        assert_eq!(DuckDBType::Boolean.to_string(), String::from("BOOLEAN"));
        assert_eq!(DuckDBType::Date.to_string(), String::from("DATE"));

        assert_eq!(
            DuckDBType::Decimal(Some((18, 3))).to_string(),
            String::from("DECIMAL(18,3)")
        );

        assert_eq!(DuckDBType::Double.to_string(), String::from("DOUBLE"));
        assert_eq!(DuckDBType::Float.to_string(), String::from("FLOAT"));
        assert_eq!(DuckDBType::HugeInt.to_string(), String::from("HUGEINT"));
        assert_eq!(DuckDBType::Integer.to_string(), String::from("INTEGER"));
        assert_eq!(DuckDBType::Interval.to_string(), String::from("INTERVAL"));
        assert_eq!(DuckDBType::Json.to_string(), String::from("JSON"));
        assert_eq!(DuckDBType::SmallInt.to_string(), String::from("SMALLINT"));
        assert_eq!(DuckDBType::Time.to_string(), String::from("TIME"));
        assert_eq!(
            DuckDBType::TimestampWithTimeZone.to_string(),
            String::from("TIMESTAMP WITH TIME ZONE")
        );
        assert_eq!(DuckDBType::Timestamp.to_string(), String::from("TIMESTAMP"));
        assert_eq!(DuckDBType::TinyInt.to_string(), String::from("TINYINT"));
        assert_eq!(DuckDBType::UBigInt.to_string(), String::from("UBIGINT"));
        assert_eq!(DuckDBType::UHugeInt.to_string(), String::from("UHUGEINT"));
        assert_eq!(DuckDBType::UInteger.to_string(), String::from("UINTEGER"));
        assert_eq!(DuckDBType::USmallInt.to_string(), String::from("USMALLINT"));
        assert_eq!(DuckDBType::UTinyInt.to_string(), String::from("UTINYINT"));
        assert_eq!(DuckDBType::Uuid.to_string(), String::from("UUID"));
        assert_eq!(DuckDBType::Varchar.to_string(), String::from("VARCHAR"));
    }

    #[test]
    fn nested_type_to_string_test() {
        assert_eq!(
            DuckDBType::Array(Box::new(DuckDBType::Integer), 3).to_string(),
            String::from("INTEGER[3]")
        );

        assert_eq!(
            DuckDBType::List(Box::new(DuckDBType::Integer)).to_string(),
            String::from("INTEGER[]"),
        );

        assert_eq!(
            DuckDBType::Map(Box::new(DuckDBType::Integer), Box::new(DuckDBType::Varchar))
                .to_string(),
            String::from("MAP(INTEGER, VARCHAR)"),
        );

        assert_eq!(
            DuckDBType::Struct(vec![
                StructField {
                    name: "num".to_string(),
                    typ: DuckDBType::Integer
                },
                StructField {
                    name: "str".to_string(),
                    typ: DuckDBType::Varchar
                },
            ])
            .to_string(),
            String::from("STRUCT(num INTEGER, str VARCHAR)"),
        );

        assert_eq!(
            DuckDBType::Union(vec![
                StructField {
                    name: "num".to_string(),
                    typ: DuckDBType::Integer
                },
                StructField {
                    name: "\"text\"".to_string(),
                    typ: DuckDBType::Varchar
                },
            ])
            .to_string(),
            String::from("UNION(num INTEGER, \"text\" VARCHAR)"),
        );

        // complex types
        assert_eq!(
            DuckDBType::Struct(vec![
                StructField {
                    name: "birds".to_string(),
                    typ: DuckDBType::List(Box::new(DuckDBType::Varchar))
                },
                StructField {
                    name: "aliens".to_string(),
                    typ: DuckDBType::Integer
                },
                StructField {
                    name: "amphibians".to_string(),
                    typ: DuckDBType::List(Box::new(DuckDBType::Varchar))
                },
            ])
            .to_string(),
            String::from("STRUCT(birds VARCHAR[], aliens INTEGER, amphibians VARCHAR[])"),
        );

        assert_eq!(
            DuckDBType::Struct(vec![StructField {
                name: "test".to_string(),
                typ: DuckDBType::List(Box::new(DuckDBType::Map(
                    Box::new(DuckDBType::Integer),
                    Box::new(DuckDBType::Decimal(Some((11, 1))))
                )))
            },])
            .to_string(),
            String::from("STRUCT(test MAP(INTEGER, DECIMAL(11,1))[])"),
        );

        assert_eq!(
            DuckDBType::List(Box::new(DuckDBType::Union(vec![
                StructField {
                    name: "str".to_string(),
                    typ: DuckDBType::Varchar
                },
                StructField {
                    name: "num".to_string(),
                    typ: DuckDBType::Integer
                },
            ])))
            .to_string(),
            String::from("UNION(str VARCHAR, num INTEGER)[]"),
        );
    }
}
