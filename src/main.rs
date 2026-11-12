//! elephant-cli: validate, hash, export, upload, prepare and transform
//! Elephant county data.
//!
//! Conventions every command follows, so the CLI is easy to script:
//! - stdout carries the result: a short text report, or with `--json` exactly
//!   one JSON document. Progress, warnings and errors go to stderr.
//! - Exit code 0 means success, 1 means the input was checked and found
//!   wanting, 2 means the command could not run (bad arguments, unreadable
//!   input, network failure).
//! - Nothing prompts, nothing needs a terminal.

mod car;
mod county;
mod lexicon;
mod property;
mod report;
mod schemas;
mod validate;

use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub type Fail = Box<dyn std::error::Error + Send + Sync>;

#[derive(Parser)]
#[command(name = "elephant-cli", version, about = "Validate, hash, export, upload, prepare and transform Elephant county data.")]
#[command(after_help = "Exit codes: 0 success, 1 the input failed its checks, 2 the command could not run.\nWith --json, stdout is exactly one JSON document; everything else goes to stderr.")]
struct Cli {
    /// Print one JSON document describing the result on stdout instead of text
    #[arg(long, global = true)]
    json: bool,
    /// Directory holding lexicon schemas, one <cid>.json per schema [default: ~/.elephant-cli/schema-cache]
    #[arg(long, global = true, value_name = "DIR", env = "ELEPHANT_SCHEMA_CACHE_DIR")]
    schema_cache: Option<PathBuf>,
    /// Never use the network: a schema missing from the cache is an error
    #[arg(long, global = true, env = "ELEPHANT_OFFLINE", value_parser = clap::builder::BoolishValueParser::new())]
    offline: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Check property outputs or a county CAR against the lexicon
    Validate(Validate),
}

#[derive(Args)]
#[command(after_help = "Examples:\n  elephant-cli validate ./property-dir\n  elephant-cli validate ./county-outputs --output-csv errors.csv\n  elephant-cli validate county.car --output-csv errors.csv\n  elephant-cli --json validate county.car | jq .errors\n  elephant-cli validate county.car --output-csv - > findings.csv")]
struct Validate {
    /// A property directory or ZIP, a directory of properties, or a county CAR (`.car`)
    input: PathBuf,
    /// CSV file for the findings, one row each; `-` writes them to stdout
    #[arg(short, long, value_name = "PATH", default_value = "submit_errors.csv")]
    output_csv: PathBuf,
    /// Threads to check with [default: number of cores]
    #[arg(long, value_name = "N")]
    threads: Option<usize>,
}

/// What a command produced: the JSON document, the text report, and whether the input passed.
struct Done {
    json: Value,
    text: String,
    passed: bool,
}

fn threads(asked: Option<usize>) -> usize {
    asked.unwrap_or_else(|| std::thread::available_parallelism().map_or(1, usize::from)).max(1)
}

/// The names of properties that failed, shortened for a terminal.
fn listed(names: &[String]) -> String {
    match names.len() {
        0..=20 => names.join(", "),
        more => format!("{}, and {} more", names[..20].join(", "), more - 20),
    }
}

fn validate(args: &Validate, cli: &Cli) -> Result<Done, Fail> {
    if !args.input.exists() {
        return Err(format!("{} is not a readable file", args.input.display()).into());
    }
    if args.input.to_string_lossy().to_lowercase().ends_with(".car") {
        return county(args, cli);
    }
    let shared = validate::Shared::new(schemas::Schemas::new(cli.schema_cache.clone(), cli.offline));
    let children = property::children(&args.input);
    if children.is_empty() {
        let opened = property::Property::open(&args.input)?;
        let checked = validate::property(&opened, &shared)?;
        let mut report = report::Report::create(&args.output_csv)?;
        for row in &checked.rows {
            report.write(row)?;
        }
        report.finish()?;
        let count = checked.rows.len();
        let mut text = String::from("Validation report\n");
        text += &format!("  Data groups validated:  {}\n", checked.groups);
        text += &format!("  Errors:                 {count}\n");
        text += &match count {
            0 => "All data groups passed validation\n".to_string(),
            _ => format!("{count} errors found. Check {} for details.\n", args.output_csv.display()),
        };
        return Ok(Done {
            json: json!({
                "command": "validate",
                "input": args.input,
                "kind": "property",
                "valid": count == 0,
                "data_groups": checked.groups,
                "error_count": count,
                "output_csv": args.output_csv,
            }),
            text,
            passed: count == 0,
        });
    }
    let names: Vec<String> = children.iter().map(|child| property::stem(child)).collect();
    let mut seen = std::collections::HashSet::new();
    let repeated: Vec<&str> =
        names.iter().filter(|name| !seen.insert(name.to_lowercase())).map(String::as_str).collect();
    if !repeated.is_empty() {
        return Err(format!("Duplicate property names in {}: {}", args.input.display(), repeated.join(", ")).into());
    }
    let results = validate::batch(&children, &shared, threads(args.threads));
    let mut report = report::Report::create(&args.output_csv)?;
    let mut failed = Vec::new();
    let mut groups = 0;
    for (name, result) in names.iter().zip(results) {
        let rows = match result {
            Ok(checked) => {
                groups += checked.groups;
                checked.rows
            }
            // A property that could not be checked gets a row of its own, so the CSV explains every failure.
            Err(reason) => vec![report::Row {
                property: name.clone(),
                path: "root".to_string(),
                message: reason,
                ..report::Row::default()
            }],
        };
        if !rows.is_empty() {
            failed.push(name.clone());
        }
        for row in &rows {
            report.write(row)?;
        }
    }
    report.finish()?;
    let mut text = format!(
        "Properties processed: {}, succeeded: {}, failed: {}\n",
        names.len(),
        names.len() - failed.len(),
        failed.len()
    );
    if !failed.is_empty() {
        eprintln!("{} of {} properties failed: {}", failed.len(), names.len(), listed(&failed));
        text += &format!("{} errors found. Check {} for details.\n", report.rows, args.output_csv.display());
    }
    Ok(Done {
        json: json!({
            "command": "validate",
            "input": args.input,
            "kind": "batch",
            "valid": failed.is_empty(),
            "properties": names.len(),
            "succeeded": names.len() - failed.len(),
            "failed": failed,
            "data_groups": groups,
            "error_count": report.rows,
            "output_csv": args.output_csv,
        }),
        text,
        passed: failed.is_empty(),
    })
}

fn county(args: &Validate, cli: &Cli) -> Result<Done, Fail> {
    if !args.input.is_file() {
        return Err(format!("{} is not a readable file", args.input.display()).into());
    }
    let mut schemas = schemas::Schemas::new(cli.schema_cache.clone(), cli.offline);
    let mut report = report::Report::create(&args.output_csv)?;
    let summary = county::validate(&args.input, &mut schemas, &mut report, threads(args.threads))?;
    report.finish()?;
    let failed: u64 = summary.errors.iter().sum();
    let errors: serde_json::Map<String, Value> =
        county::CHECKS.iter().zip(summary.errors).map(|(check, count)| (check.to_string(), json!(count))).collect();
    let mut text = String::from("CAR validation report\n");
    text += &format!("  Blocks:                 {}\n", summary.blocks);
    text += &format!("  Properties:             {}\n", summary.properties);
    text += &format!("  Data groups validated:  {}\n", summary.groups);
    for (check, count) in county::CHECKS.iter().zip(summary.errors) {
        text += &format!("  {:<24}{count}\n", format!("{check} errors:"));
    }
    if summary.lookups > 0 {
        text += &format!(
            "  {} blocks are not stored next to the shard that links to them; the whole file was indexed to look them up by CID, which is slower and takes more memory\n",
            summary.lookups
        );
    }
    text += &match failed {
        0 => "CAR passed every check\n".to_string(),
        _ => format!("{failed} errors found. Check {} for details.\n", args.output_csv.display()),
    };
    Ok(Done {
        json: json!({
            "command": "validate",
            "input": args.input,
            "kind": "county-car",
            "valid": failed == 0,
            "blocks": summary.blocks,
            "properties": summary.properties,
            "data_groups": summary.groups,
            "lookups": summary.lookups,
            "errors": errors,
            "error_count": failed,
            "output_csv": args.output_csv,
        }),
        text,
        passed: failed == 0,
    })
}

fn run(cli: &Cli) -> Result<Done, Fail> {
    match &cli.command {
        Command::Validate(args) => validate(args, cli),
    }
}

/// Whether stdout already carries the findings CSV, so the report must not go there too.
fn piped(cli: &Cli) -> bool {
    match &cli.command {
        Command::Validate(args) => args.output_csv == Path::new("-"),
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(done) => {
            match (cli.json, piped(&cli)) {
                (_, true) => eprint!("{}", done.text),
                (true, false) => println!("{}", done.json),
                (false, false) => print!("{}", done.text),
            }
            ExitCode::from(u8::from(!done.passed))
        }
        Err(error) => {
            eprintln!("error: {error}");
            if cli.json && !piped(&cli) {
                println!("{}", json!({ "error": error.to_string() }));
            }
            ExitCode::from(2)
        }
    }
}
