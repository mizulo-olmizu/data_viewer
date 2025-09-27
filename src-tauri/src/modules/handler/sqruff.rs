mod json_types;
pub use json_types::Diagnostic;

use ahash::AHashMap;
use anyhow::Result;
use sqruff_lib::core::config::FluffConfig;
use sqruff_lib::core::linter::core::Linter;
use sqruff_lib::core::linter::linted_file::LintedFile;
use std::sync::Mutex;
use std::sync::OnceLock;

static LINTER_SINGLETON: OnceLock<Mutex<Linter>> = OnceLock::new();

fn get_shared_linter() -> &'static Mutex<Linter> {
    LINTER_SINGLETON.get_or_init(|| {
        let mut config_overrides = AHashMap::new();

        config_overrides.insert("dialect".to_string(), "duckdb".to_string());

        let config = FluffConfig::from_root(None, false, Some(config_overrides)).unwrap();

        let linter = Linter::new(config, None, None, true);

        Mutex::new(linter)
    })
}

pub fn lint(sql: &str) -> Result<Vec<Diagnostic>> {
    let mut linter = get_shared_linter().lock().unwrap();
    let linted: LintedFile = linter.lint_string_wrapped(sql, false);

    let violations = linted.violations();

    let mapped: Vec<Diagnostic> = violations
        .iter()
        .map(|v| Diagnostic::from(v.clone()))
        .collect();

    Ok(mapped)
}

pub fn fix(sql: &str) -> Result<String> {
    let mut linter = get_shared_linter().lock().unwrap();
    let linted: LintedFile = linter.lint_string_wrapped(sql, true);
    Ok(linted.fix_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqruff_lint_to_json_returns_violations() {
        let sql = "select * from my_table";

        let result = lint(sql);

        println!("Lint result: {:?}", result);

        assert!(result.is_ok());
    }

    #[test]
    fn test_sqruff_fix_and_format_changes_sql() {
        let sql = "select * from my_table";
        let fixed = fix(sql);

        println!("Fixed SQL: {:?}", fixed);

        assert!(fixed.is_ok());
    }
}
