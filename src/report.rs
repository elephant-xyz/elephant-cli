//! The CSV of findings every `validate` path writes.

use crate::Fail;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// One finding. `path` is a check name or the JSON path of a schema error.
#[derive(Default, Clone)]
pub struct Row {
    pub property: String,
    pub group: String,
    pub file: String,
    pub path: String,
    pub message: String,
    pub value: String,
}

pub struct Report {
    out: BufWriter<Box<dyn Write>>,
    pub rows: u64,
}

fn escape(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    if escaped.contains([',', '\n', '"']) {
        return format!("\"{escaped}\"");
    }
    escaped
}

/// The current time as JavaScript's `toISOString()` prints it.
pub fn now() -> String {
    let since = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let (days, secs) = (since.as_secs() / 86400, since.as_secs() % 86400);
    // days since 1970-01-01 to a civil date (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let (day, month) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60,
        since.subsec_millis()
    )
}

impl Report {
    /// Start the CSV at `path`; `-` writes it to stdout.
    pub fn create(path: &Path) -> Result<Report, Fail> {
        let out: Box<dyn Write> = if path.as_os_str() == "-" {
            Box::new(std::io::stdout())
        } else {
            Box::new(File::create(path).map_err(|error| format!("cannot write {}: {error}", path.display()))?)
        };
        let mut out = BufWriter::new(out);
        writeln!(out, "property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp")?;
        Ok(Report { out, rows: 0 })
    }

    pub fn write(&mut self, row: &Row) -> Result<(), Fail> {
        self.rows += 1;
        writeln!(
            self.out,
            "{},{},{},{},{},{},{}",
            row.property,
            row.group,
            escape(&row.file),
            escape(&row.path),
            escape(&row.message),
            escape(&row.value),
            now()
        )?;
        Ok(())
    }

    pub fn finish(&mut self) -> Result<(), Fail> {
        Ok(self.out.flush()?)
    }
}
