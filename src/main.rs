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

mod browser;
mod canonical;
mod car;
mod cids;
mod county;
mod flow;
mod hash;
mod js;
mod lexicon;
mod prepare;
mod property;
mod report;
mod schemas;
mod tables;
mod transform;
mod unixfs;
mod upload;
mod validate;

use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub type Fail = Box<dyn std::error::Error + Send + Sync>;

#[derive(Parser)]
#[command(name = "elephant-cli", version, about = "Validate, hash, export, upload, prepare and transform Elephant county data.")]
#[command(
    after_help = "Exit codes: 0 success, 1 the input failed its checks, 2 the command could not run.\nWith --json, stdout is exactly one JSON document; everything else goes to stderr."
)]
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
    /// Give property outputs their CIDs and pack them into hashed ZIPs, a CSV and a county CAR
    Hash(Hash),
    /// Turn a county CAR into Parquet tables and, optionally, its Atlas page entry
    ExportTables(ExportTables),
    /// Send a county CAR or a tables directory to an IPFS node and verify it arrived
    Upload(Upload),
    /// Turn prepared source content into lexicon data-group files with county scripts or a handler package
    Transform(Transform),
    /// Fetch the source content for a parcel and add it to its seed ZIP
    Prepare(Prepare),
}

#[derive(Args)]
#[command(
    after_help = "The first mechanism that applies answers the seed's request:\n  --browser-flow-zip            a Browser Flow v2 package saves named captures\n  --multi-request-flow-file     several HTTP requests into one JSON file\n  (county Orange)               the Orange County, FL appraiser API\n  --browser-flow-file           a browser flow written as JSON\n  --browser-flow-template       a built-in flow, with --browser-flow-parameters\n  --use-browser                 a plain page load in the browser (GET only)\n  otherwise                     one HTTP request\n\nBrowser mechanisms need the obscura headless browser (https://github.com/h4ckf0r0day/obscura):\n`obscura` on PATH, --browser/OBSCURA_BIN, or --cdp-url/ELEPHANT_CDP_URL for a running browser.\n\nExamples:\n  elephant-cli prepare seed.zip --output-zip prepared.zip\n  elephant-cli prepare seed.zip --output-zip prepared.zip --browser-flow-zip flow.zip\n  elephant-cli prepare --input-csv parcels.csv --multi-request-flow-file flow.json --output-zip prepared.zip"
)]
struct Prepare {
    /// The seed ZIP: parcel.json or property_seed.json, and address.json or unnormalized_address.json
    input_zip: Option<PathBuf>,
    /// ZIP to write: the seed files plus what was fetched
    #[arg(long, value_name = "PATH")]
    output_zip: PathBuf,
    /// Instead of a seed ZIP: a CSV with a request_identifier column, one output file per row
    #[arg(long, value_name = "PATH")]
    input_csv: Option<PathBuf>,
    /// A multi-request flow: several HTTP requests answered into one JSON file
    #[arg(long, value_name = "PATH")]
    multi_request_flow_file: Option<PathBuf>,
    /// A browser flow written as JSON
    #[arg(long, value_name = "PATH")]
    browser_flow_file: Option<PathBuf>,
    /// A built-in browser flow; the only one is SEARCH_BY_PARCEL_ID
    #[arg(long, value_name = "NAME", requires = "browser_flow_parameters")]
    browser_flow_template: Option<String>,
    /// The template's parameters, as JSON
    #[arg(long, value_name = "JSON", requires = "browser_flow_template")]
    browser_flow_parameters: Option<String>,
    /// A Browser Flow v2 package (handler.js)
    #[arg(long, value_name = "PATH")]
    browser_flow_zip: Option<PathBuf>,
    /// Accepted for compatibility: `2` with --browser-flow-zip
    #[arg(long, value_name = "VERSION")]
    browser_flow_version: Option<String>,
    /// Load the page in the browser instead of fetching it (GET requests)
    #[arg(long)]
    use_browser: bool,
    /// With --use-browser: do not click the "Continue" notice some county sites show first
    #[arg(long)]
    no_continue: bool,
    /// With --use-browser: click this element once the page has loaded
    #[arg(long, value_name = "SELECTOR")]
    continue_button: Option<String>,
    /// With --use-browser: do not wait for a reCAPTCHA redirect or treat the word as an error page
    #[arg(long)]
    ignore_captcha: bool,
    /// Proxy for the browser: http://user:password@host:port
    #[arg(long, value_name = "URL")]
    proxy: Option<String>,
    /// The obscura binary to start
    #[arg(long, value_name = "PATH", env = "OBSCURA_BIN")]
    browser: Option<PathBuf>,
    /// Attach to a running browser's DevTools WebSocket instead of starting obscura
    #[arg(long, value_name = "WS_URL", env = "ELEPHANT_CDP_URL")]
    cdp_url: Option<String>,
    /// Accepted for compatibility: the browser has no window to show
    #[arg(long, hide = true)]
    no_headless: bool,
}

#[derive(Args)]
#[command(
    after_help = "Modes:\n  --input-zip only                 seed.csv -> seed records\n  --scripts-zip <zip>              the five county scripts (ownerMapping.js ... data_extractor.js)\n  --transform-zip <zip>            a Transform v2 handler package (handler.js)\n\nScripts and handlers run on an embedded JavaScript engine: they can read and write only their\nworking directory, cannot use the network, and get fs, path, process, console, Buffer, crypto\n(sha256/sha512) and cheerio.\n\nExamples:\n  elephant-cli transform --input-zip prepared.zip --scripts-zip scripts.zip --output-zip transformed.zip\n  elephant-cli transform --input-zip prepared.zip --transform-zip handler.zip --output-zip transformed.zip"
)]
struct Transform {
    /// What `prepare` wrote for one parcel (or a ZIP holding seed.csv)
    #[arg(long, value_name = "PATH")]
    input_zip: PathBuf,
    /// ZIP to write, holding data/*.json
    #[arg(long, value_name = "PATH", default_value = "transformed-data.zip")]
    output_zip: PathBuf,
    /// ZIP of county scripts
    #[arg(long, value_name = "PATH")]
    scripts_zip: Option<PathBuf>,
    /// Transform v2 handler package
    #[arg(long, value_name = "PATH")]
    transform_zip: Option<PathBuf>,
    /// Accepted for compatibility: `2` with --transform-zip
    #[arg(long, value_name = "VERSION")]
    transform_version: Option<String>,
    /// Label of the data group a handler package builds
    #[arg(long, value_name = "LABEL")]
    data_group: Option<String>,
}

#[derive(Args)]
#[command(
    after_help = "Environment: IPFS_API, IPFS_API_TOKEN, ELEPHANT_CAR_GATEWAY, or FILEBASE_ACCESS_KEY + FILEBASE_SECRET_KEY + FILEBASE_BUCKET.\n\nExamples:\n  elephant-cli upload county.car --output-json upload.json\n  elephant-cli upload ./tables --api https://rpc.filebase.io\n  elephant-cli --json upload county.car | jq -r .gatewayUrl"
)]
struct Upload {
    /// A county CAR (`.car`) or a tables directory written by `export-tables`
    input: PathBuf,
    /// Kubo RPC API of the node [default: http://127.0.0.1:5001]
    #[arg(long, value_name = "URL")]
    api: Option<String>,
    /// Bearer token for the API
    #[arg(long, value_name = "BEARER")]
    token: Option<String>,
    /// Gateway to read the upload back from [default: the node's, or Filebase's for its API]
    #[arg(long, value_name = "URL")]
    gateway: Option<String>,
    /// Seconds to wait for the gateway to serve what was uploaded
    #[arg(long, value_name = "SECONDS", default_value = "300")]
    timeout: String,
    /// Also write the summary (the same document --json prints) to this file
    #[arg(long, value_name = "PATH")]
    output_json: Option<PathBuf>,
}

#[derive(Args)]
#[command(
    after_help = "Examples:\n  elephant-cli export-tables county.car --output ./tables --output-json tables.json \\\n    --atlas-page ./atlas/counties/IL/rock-island.json --county rock-island --state IL --fips 17161\n  elephant-cli --json export-tables county.car --output ./tables | jq -r .root"
)]
struct ExportTables {
    /// A county CAR written by `hash --output-car`
    input: PathBuf,
    /// Directory that receives <table>/part-NNNNN.parquet files and tables.car
    #[arg(long, value_name = "DIR")]
    output: PathBuf,
    /// Largest part file, as a byte count with an optional k, m or g
    #[arg(long, value_name = "BYTES", default_value = "1g")]
    part_size: String,
    /// Also write the summary (the same document --json prints) to this file
    #[arg(long, value_name = "PATH")]
    output_json: Option<PathBuf>,
    /// Create or update the Atlas county page with this archive's root, schema and tables root
    #[arg(long, value_name = "PATH")]
    atlas_page: Option<PathBuf>,
    /// County key for a new Atlas page
    #[arg(long, value_name = "KEY")]
    county: Option<String>,
    /// Two-letter state code for a new Atlas page
    #[arg(long, value_name = "ST")]
    state: Option<String>,
    /// Five-digit county FIPS code for a new Atlas page
    #[arg(long, value_name = "CODE")]
    fips: Option<String>,
}

#[derive(Args)]
#[command(
    after_help = "Examples:\n  elephant-cli hash ./county-outputs --output-zip ./hashed --output-csv hash.csv --output-car county.car\n  elephant-cli --json hash ./property-dir | jq -r .property_cid"
)]
struct Hash {
    /// A property directory or ZIP, or a directory of properties
    input: PathBuf,
    /// Hashed ZIP to write; for a directory of properties, a directory that receives one ZIP each
    #[arg(short = 'o', long, value_name = "PATH", default_value = "hashed-data.zip")]
    output_zip: PathBuf,
    /// CSV listing each data group's CID
    #[arg(short = 'c', long, value_name = "PATH", default_value = "hash-results.csv")]
    output_csv: PathBuf,
    /// County CAR to write: every JSON block, shard blocks and the county index as root
    #[arg(long, value_name = "PATH")]
    output_car: Option<PathBuf>,
    /// Threads to hash with [default: number of cores]
    #[arg(long, value_name = "N")]
    threads: Option<usize>,
}

#[derive(Args)]
#[command(
    after_help = "Examples:\n  elephant-cli validate ./property-dir\n  elephant-cli validate ./county-outputs --output-csv errors.csv\n  elephant-cli validate county.car --output-csv errors.csv\n  elephant-cli --json validate county.car | jq .errors\n  elephant-cli validate county.car --output-csv - > findings.csv"
)]
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
    let names = property::stems(&children, &args.input)?;
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
            Err(reason) => {
                vec![report::Row { property: name.clone(), path: "root".to_string(), message: reason, ..report::Row::default() }]
            }
        };
        if !rows.is_empty() {
            failed.push(name.clone());
        }
        for row in &rows {
            report.write(row)?;
        }
    }
    report.finish()?;
    let mut text =
        format!("Properties processed: {}, succeeded: {}, failed: {}\n", names.len(), names.len() - failed.len(), failed.len());
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

fn hash(args: &Hash, cli: &Cli) -> Result<Done, Fail> {
    if !args.input.exists() {
        return Err(format!("{} is not a readable file", args.input.display()).into());
    }
    let shared = validate::Shared::new(schemas::Schemas::new(cli.schema_cache.clone(), cli.offline));
    let outcome =
        hash::run(&args.input, &args.output_zip, &args.output_csv, args.output_car.as_deref(), &shared, threads(args.threads))?;
    for error in &outcome.errors {
        eprintln!("error: {error}");
    }
    let batch = outcome.cid.is_none() && !(outcome.properties == 1 && outcome.failed.len() == 1);
    let mut text = String::new();
    if let Some(cid) = &outcome.cid {
        text += "Hash report\n";
        text += &format!("  Property CID:        {cid}\n");
        text += &format!("  Data groups hashed:  {}\n", outcome.groups);
        text += &format!("  Output ZIP:          {}\n", args.output_zip.display());
        text += &format!("  Output CSV:          {}\n", args.output_csv.display());
    }
    if let (Some((blocks, root)), Some(path)) = (&outcome.car, &args.output_car) {
        text += &format!("CAR written: {} ({blocks} blocks, root {root})\n", path.display());
    }
    if batch {
        text += &format!(
            "Properties processed: {}, succeeded: {}, failed: {}\n",
            outcome.properties,
            outcome.properties - outcome.failed.len(),
            outcome.failed.len()
        );
    }
    if !outcome.failed.is_empty() {
        eprintln!("{} of {} properties failed: {}", outcome.failed.len(), outcome.properties, listed(&outcome.failed));
    }
    Ok(Done {
        json: json!({
            "command": "hash",
            "input": args.input,
            "kind": if batch { "batch" } else { "property" },
            "ok": outcome.failed.is_empty(),
            "properties": outcome.properties,
            "succeeded": outcome.properties - outcome.failed.len(),
            "failed": outcome.failed,
            "errors": outcome.errors,
            "data_groups": outcome.groups,
            "property_cid": outcome.cid,
            "output_zip": args.output_zip,
            "output_csv": args.output_csv,
            "car": outcome.car.as_ref().map(|(blocks, root)| json!({ "path": args.output_car, "blocks": blocks, "root": root })),
        }),
        text,
        passed: outcome.failed.is_empty(),
    })
}

/// `300`, `64m`, `1g`: a positive byte count.
fn size(text: &str) -> Option<u64> {
    let lower = text.to_lowercase();
    let (digits, unit) = match lower.strip_suffix(['k', 'm', 'g']) {
        Some(digits) => (digits, 1u64 << (10 * (1 + "kmg".find(&lower[digits.len()..])? as u32))),
        None => (lower.as_str(), 1),
    };
    let count: u64 = digits.parse().ok().filter(|_| digits.bytes().all(|byte| byte.is_ascii_digit()))?;
    count.checked_mul(unit).filter(|bytes| *bytes > 0)
}

fn export_tables(args: &ExportTables, cli: &Cli) -> Result<Done, Fail> {
    let Some(cap) = size(&args.part_size) else {
        return Err(format!("--part-size must be a positive byte count such as 1g, got {}", args.part_size).into());
    };
    if !args.input.is_file() {
        return Err(format!("{} is not a readable file", args.input.display()).into());
    }
    let mut schemas = schemas::Schemas::new(cli.schema_cache.clone(), cli.offline);
    let atlas = args.atlas_page.as_ref().map(|page| tables::Atlas {
        page: page.clone(),
        county: args.county.clone(),
        state: args.state.clone(),
        fips: args.fips.clone(),
    });
    let exported = tables::export(&args.input, &args.output, cap, atlas.as_ref(), &mut schemas)
        .map_err(|error| format!("Failed to export tables: {error}"))?;
    let whole = |path: &Path| std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let listed: serde_json::Map<String, Value> =
        exported.tables.iter().map(|(name, rows, parts)| (name.clone(), json!({ "rows": rows, "parts": parts }))).collect();
    let parts: usize = exported.tables.iter().map(|table| table.2).sum();
    let mut summary = json!({
        "output": whole(&args.output),
        "car": whole(&args.output).join("tables.car"),
        "root": exported.root,
        "countyRoot": exported.county_root,
        "partSizeBytes": cap,
        "codec": "zstd",
        "tables": listed,
        "parts": parts,
        "exportedAt": report::now(),
    });
    let mut text = format!(
        "Tables written: {} ({} tables, {parts} parts, root {})\n",
        args.output.display(),
        exported.tables.len(),
        exported.root
    );
    if let (Some(page), Some(group)) = (&args.atlas_page, &exported.group) {
        summary["atlas"] = json!({ "page": whole(page), "group": group });
        text += &format!("Atlas page written: {} group {group}\n", page.display());
    }
    if let Some(path) = &args.output_json {
        std::fs::write(path, serde_json::to_string_pretty(&summary)?)
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    }
    Ok(Done { json: summary, text, passed: true })
}

fn upload(args: &Upload) -> Result<Done, Fail> {
    let target = upload::Target::new(args.api.as_deref(), args.token.as_deref(), args.gateway.as_deref(), &args.timeout)?;
    let archive = args.input.to_string_lossy().to_lowercase().ends_with(".car");
    let summary = match (archive, args.input.join("tables.car").is_file()) {
        (true, _) => {
            let sent = upload::car(&args.input, &target)?;
            json!({
                "api": target.api,
                "root": sent.root.to_string(),
                "blocks": sent.blocks,
                "gatewayUrl": sent.gateway_url,
                "uploadedAt": sent.uploaded_at,
            })
        }
        (false, true) => {
            let sent = upload::tables(&args.input, &target)?;
            json!({
                "api": target.api,
                "root": sent.imported.root.to_string(),
                "countyRoot": sent.county_root,
                "parts": sent.parts,
                "gatewayUrl": sent.imported.gateway_url,
                "uploadedAt": sent.imported.uploaded_at,
            })
        }
        _ => {
            return Err(format!(
                "{} is neither a .car file nor a tables directory written by export-tables",
                args.input.display()
            )
            .into())
        }
    };
    if let Some(path) = &args.output_json {
        std::fs::write(path, serde_json::to_string_pretty(&summary)?)
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    }
    let mut text = String::from("Upload completed\n");
    for (key, value) in summary.as_object().into_iter().flatten() {
        text += &format!("  {key}: {}\n", value.as_str().map_or_else(|| value.to_string(), str::to_string));
    }
    Ok(Done { json: summary, text, passed: true })
}

fn transform(args: &Transform, cli: &Cli) -> Result<Done, Fail> {
    match (args.transform_version.as_deref(), &args.transform_zip, &args.scripts_zip) {
        (Some("2"), None, _) => return Err("--transform-zip is required for transform v2".into()),
        (Some("2"), _, Some(_)) => return Err("--scripts-zip cannot be used with transform v2".into()),
        (Some(other), _, _) if other != "2" => {
            return Err(format!("--transform-version {other} is not supported; only 2 is").into())
        }
        _ => {}
    }
    let mut schemas = schemas::Schemas::new(cli.schema_cache.clone(), cli.offline);
    let options = transform::Options {
        input: &args.input_zip,
        output: &args.output_zip,
        scripts: args.scripts_zip.as_deref(),
        package: args.transform_zip.as_deref(),
        group: args.data_group.as_deref(),
    };
    let done = transform::run(&options, &mut schemas).map_err(|error| format!("Transform failed: {error}"))?;
    let text = format!(
        "Transform finished ({} mode)\n  Files written:  {}\n  Output ZIP:     {}\n",
        done.mode,
        done.files.len(),
        args.output_zip.display()
    );
    Ok(Done {
        json: json!({ "command": "transform", "mode": done.mode, "input_zip": args.input_zip, "output_zip": args.output_zip, "files": done.files }),
        text,
        passed: true,
    })
}

fn prepare(args: &Prepare) -> Result<Done, Fail> {
    match (args.browser_flow_version.as_deref(), &args.browser_flow_zip) {
        (Some("2"), None) => return Err("--browser-flow-zip is required for browser flow v2".into()),
        (Some(other), _) if other != "2" => {
            return Err(format!("--browser-flow-version {other} is not supported; only 2 is").into())
        }
        _ => {}
    }
    if let Some(proxy) = args.proxy.as_deref().filter(|proxy| !proxy.contains('@') && !proxy.contains("://")) {
        return Err(format!("Invalid proxy format: {proxy}. Expected http://user:password@host:port").into());
    }
    let template = args.browser_flow_template.as_deref().zip(args.browser_flow_parameters.as_deref());
    let options = prepare::Options {
        input: args.input_zip.as_deref(),
        csv: args.input_csv.as_deref(),
        output: &args.output_zip,
        multi: args.multi_request_flow_file.as_deref(),
        flow: args.browser_flow_file.as_deref(),
        template,
        package: args.browser_flow_zip.as_deref(),
        browse: args.use_browser,
        proceed: !args.no_continue,
        button: args.continue_button.as_deref(),
        captcha: args.ignore_captcha,
        launch: browser::Launch { binary: args.browser.clone(), endpoint: args.cdp_url.clone(), proxy: args.proxy.clone() },
    };
    let done = prepare::run(&options).map_err(|error| format!("Prepare failed: {error}"))?;
    let text = format!(
        "Prepare finished ({})\n  Files written:  {}\n  Output ZIP:     {}\n",
        done.mechanism,
        done.files.len(),
        args.output_zip.display()
    );
    Ok(Done {
        json: json!({ "command": "prepare", "mechanism": done.mechanism, "output_zip": args.output_zip, "files": done.files }),
        text,
        passed: true,
    })
}

fn run(cli: &Cli) -> Result<Done, Fail> {
    match &cli.command {
        Command::Validate(args) => validate(args, cli),
        Command::Hash(args) => hash(args, cli),
        Command::ExportTables(args) => export_tables(args, cli),
        Command::Upload(args) => upload(args).map_err(|error| format!("Upload failed: {error}").into()),
        Command::Transform(args) => transform(args, cli),
        Command::Prepare(args) => prepare(args),
    }
}

/// Whether stdout already carries the findings CSV, so the report must not go there too.
fn piped(cli: &Cli) -> bool {
    match &cli.command {
        Command::Validate(args) => args.output_csv == Path::new("-"),
        Command::Hash(_) | Command::ExportTables(_) | Command::Upload(_) | Command::Transform(_) | Command::Prepare(_) => false,
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
