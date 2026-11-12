//! The lexicon check: a port of elephant-cli's `JsonValidatorService` for the
//! county CAR path, on top of the `jsonschema` crate.
//!
//! A schema node `{"type": "string", "cid": X}` is replaced by the schema X;
//! where that happens the data may hold a `{"/": cid}` pointer, which is
//! replaced by the block it names before the data is validated.

use crate::report::Row;
use crate::schemas::Schemas;
use cid::Cid;
use jsonschema::error::{TypeKind, ValidationErrorKind};
use jsonschema::paths::Location;
use jsonschema::{Draft, Keyword, ValidationError, Validator};
use regex::bytes::Regex;
use serde_json::{json, Map, Value};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::LazyLock;

pub struct Finding {
    pub path: String,
    pub message: String,
    pub value: String,
}

/// A schema with its CID links replaced, and the paths where data may hold a pointer.
struct Linked {
    schema: Value,
    allowed: Vec<String>,
}

/// A data group schema, ready to validate data against.
pub enum Group {
    /// The schema could not be loaded; the reason.
    Missing(String),
    /// Not shaped like a data group schema (`label` and `relationships`, nothing else).
    Invalid,
    Broken(String),
    Ready {
        schema: Value,
        allowed: HashSet<String>,
        validator: Box<Validator>,
    },
}

pub struct Lexicon {
    linked: HashMap<String, Arc<Linked>>,
    groups: HashMap<String, Arc<Group>>,
}

static URI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u)^https?://([\w-]+@)?[\w-]+(\.[\w-]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?$").unwrap());
static IPFS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ipfs://[A-Za-z0-9]{46,64}$").unwrap());
static RATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u)^\d+\.\d{3}$").unwrap());

fn ipfs_uri(value: &str) -> bool {
    if value.starts_with("./") {
        return value.len() > 2;
    }
    IPFS.is_match(value.as_bytes())
        && Cid::try_from(&value[7..]).is_ok_and(|cid| {
            cid.version() == cid::Version::V1 && [0x55, 0x70, 0x0129].contains(&cid.codec()) && cid.hash().code() == 0x12
        })
}

/// ajv formats apply to one type; `currency` is the only numeric one, so it
/// becomes a keyword of its own.
struct Currency;

fn currency(value: &Value) -> bool {
    let Some(number) = value.as_f64() else {
        return true;
    };
    // ponytail: counts decimals in Rust's shortest form; JavaScript switches to
    // exponent notation below 1e-6, where the original accepts some values
    // this rejects.
    number.is_finite() && number >= 0.0 && format!("{number}").split_once('.').is_none_or(|(_, decimals)| decimals.len() <= 2)
}

impl<'i> Keyword<'i> for Currency {
    fn validate(&self, instance: &'i Value) -> Result<(), ValidationError<'i>> {
        if currency(instance) {
            return Ok(());
        }
        Err(ValidationError::custom("must be a positive number with at most 2 decimal places"))
    }

    fn is_valid(&self, instance: &'i Value) -> bool {
        currency(instance)
    }
}

fn currency_keyword<'a>(
    _parent: &'a Map<String, Value>,
    _value: &'a Value,
    _path: Location,
) -> Result<Box<dyn for<'i> Keyword<'i>>, ValidationError<'a>> {
    Ok(Box::new(Currency))
}

fn truthy(value: &&Value) -> bool {
    !matches!(value, Value::Null | Value::Bool(false)) && value.as_str() != Some("")
}

/// Whether a schema node is a link to another schema.
fn cid_link(fields: &Map<String, Value>) -> Option<&str> {
    let cid = fields.get("cid")?.as_str().filter(|cid| !cid.is_empty())?;
    let kind = fields.get("type")?;
    let string = kind == "string" || kind.as_array().is_some_and(|kinds| kinds.iter().any(|kind| kind == "string"));
    string.then_some(cid)
}

/// Paths grow as `a.b` for a property and `a[]` for items; re-root one recorded from ''.
fn join(base: &str, path: &str) -> String {
    if base.is_empty() || path.is_empty() {
        return format!("{base}{path}");
    }
    if path.starts_with('[') {
        return format!("{base}{path}");
    }
    format!("{base}.{path}")
}

/// A value as JavaScript's `String()` prints it.
fn text(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::String(text) => text.clone(),
        Value::Number(number) => match number.as_f64() {
            Some(float) if number.is_f64() && float.fract() == 0.0 && float.abs() < 1e21 => format!("{float:.0}"),
            _ => number.to_string(),
        },
        Value::Bool(flag) => flag.to_string(),
        other => other.to_string(),
    }
}

/// The messages of one error, worded as elephant-cli words them.
fn messages(kind: &ValidationErrorKind) -> Vec<String> {
    use ValidationErrorKind as K;
    let one = |message: String| vec![message];
    match kind {
        K::Format { format } => one(match format.as_str() {
            "date" => "must be a valid ISO date in YYYY-MM-DD format".to_string(),
            "date-time" => "must be a valid ISO date-time in YYYY-MM-DDTHH:mm:ss.sssZ format".to_string(),
            "time" => "must be a valid ISO time in HH:mm:ss format".to_string(),
            "email" => "must be a valid email address".to_string(),
            "hostname" => "must be a valid hostname".to_string(),
            "ipv4" => "must be a valid IPv4 address".to_string(),
            "ipv6" => "must be a valid IPv6 address".to_string(),
            "uri" => "must be a valid URI starting with http:// or https://".to_string(),
            "uri-reference" => "must be a valid URI reference".to_string(),
            "iri" => "must be a valid IRI (Internationalized Resource Identifier)".to_string(),
            "iri-reference" => "must be a valid IRI reference".to_string(),
            "uuid" => "must be a valid UUID".to_string(),
            "json-pointer" => "must be a valid JSON Pointer".to_string(),
            "relative-json-pointer" => "must be a valid relative JSON Pointer".to_string(),
            "regex" => "must be a valid regular expression".to_string(),
            "cid" => "must be a valid IPFS Content Identifier (CID)".to_string(),
            "ipfs_uri" => "must be a valid IPFS URI in format ipfs://[CID] with CIDv1 using raw, dag-pb, or dag-json codec and sha256 or a relative file path starting with ./".to_string(),
            "rate_percent" => "must be a percentage rate with exactly 3 decimal places (e.g., \"12.345\")".to_string(),
            other => format!("must match format \"{other}\""),
        }),
        K::Required { property } => one(format!("missing required property '{}'", text(property))),
        K::AdditionalProperties { unexpected } => {
            unexpected.iter().map(|name| format!("unexpected property '{name}'")).collect()
        }
        K::Type { kind: TypeKind::Single(kind) } => one(format!("must be {kind}")),
        K::Type { kind: TypeKind::Multiple(kinds) } => {
            one(format!("must be {}", kinds.iter().map(|kind| kind.to_string()).collect::<Vec<_>>().join(",")))
        }
        K::Enum { options } => {
            let listed = options.as_array().into_iter().flatten();
            let names: Vec<String> =
                listed.map(|option| if option.is_null() { String::new() } else { text(option) }).collect();
            one(format!("must be one of: {}", names.join(", ")))
        }
        K::AnyOf { .. } => one("must match a schema in anyOf".to_string()),
        K::OneOfNotValid { .. } | K::OneOfMultipleValid { .. } => {
            one("must match exactly one schema in oneOf".to_string())
        }
        K::Constant { .. } => one("must be equal to constant".to_string()),
        K::Pattern { pattern } => one(format!("must match pattern \"{pattern}\"")),
        K::MinLength { limit } => one(format!("must NOT have fewer than {limit} characters")),
        K::MaxLength { limit } => one(format!("must NOT have more than {limit} characters")),
        K::MinItems { limit } => one(format!("must NOT have fewer than {limit} items")),
        K::MaxItems { limit } => one(format!("must NOT have more than {limit} items")),
        K::Minimum { limit } => one(format!("must be >= {}", text(limit))),
        K::Maximum { limit } => one(format!("must be <= {}", text(limit))),
        K::ExclusiveMinimum { limit } => one(format!("must be > {}", text(limit))),
        K::ExclusiveMaximum { limit } => one(format!("must be < {}", text(limit))),
        K::Custom { message, .. } => one(message.clone()),
        other => one(format!("{other:?}")),
    }
}

/// Flatten an error and, like ajv with `allErrors`, the errors of every
/// `anyOf`/`oneOf` branch that did not match.
fn collect(error: &ValidationError<'_>, into: &mut Vec<Finding>) {
    use ValidationErrorKind as K;
    if let K::AnyOf { context } | K::OneOfNotValid { context } = error.kind() {
        context.iter().flatten().for_each(|inner| collect(inner, into));
    }
    let instance: &Value = error.instance();
    let pointer = instance.get("/").filter(|_| instance.is_object());
    let path = error.instance_path().as_str();
    for message in messages(error.kind()) {
        // A pointer left in place where the schema wants a string.
        let message = match pointer {
            Some(target) if message.contains("must be string") => {
                let target = text(target);
                if target.starts_with("./") {
                    format!("File {target} does not exist or is not a valid JSON file.")
                } else {
                    format!("Value {target} is not a valid CID or file path.")
                }
            }
            _ => message,
        };
        into.push(Finding {
            path: if path.is_empty() { "/".to_string() } else { path.to_string() },
            message,
            value: text(instance),
        });
    }
}

/// The branches of a schema's `anyOf`.
fn options(schema: Option<&Value>) -> impl Iterator<Item = &Value> {
    schema.and_then(|schema| schema.get("anyOf")).and_then(Value::as_array).into_iter().flatten()
}

/// The schema of one named property.
fn property<'a>(schema: &'a Value, key: &str) -> Option<&'a Value> {
    schema.get("properties")?.get(key).filter(truthy)
}

/// What a pointer `{"/": "<cid or ./file>"}` names: the value to put in its
/// place, or why it cannot be had.
pub type Source<'s, 'a> = &'s dyn Fn(&str) -> Result<Cow<'a, Value>, String>;

/// Replace the pointers the schema allows by the values they name.
fn pointers<'a>(
    data: &Value,
    schema: Option<&Value>,
    allowed: &HashSet<String>,
    path: &str,
    source: Source<'_, 'a>,
) -> Result<Value, String> {
    match data {
        Value::Object(fields) => {
            if let (1, Some(Value::String(pointer))) = (fields.len(), fields.get("/")) {
                let allows = allowed.contains(path)
                    || options(schema).any(|option| {
                        let kind = option.get("type");
                        kind.is_none_or(|kind| kind != "null")
                            && (kind.is_some_and(|kind| kind == "object")
                                || option.get("properties").as_ref().is_some_and(truthy)
                                || !kind.as_ref().is_some_and(truthy))
                    });
                if !allows {
                    return Ok(data.clone());
                }
                if pointer.is_empty() {
                    return Err("Failed to resolve pointer - empty string is not a valid CID or file path".to_string());
                }
                let resolved = source(pointer).and_then(|value| pointers(&value, schema, allowed, path, source));
                if Cid::try_from(pointer.as_str()).is_err() {
                    return resolved;
                }
                return resolved.map_err(|error| format!("Failed to resolve CID pointer: {error}"));
            }
            let mut resolved = Map::with_capacity(fields.len());
            for (key, value) in fields {
                if !value.is_object() && !value.is_array() {
                    resolved.insert(key.clone(), value.clone());
                    continue;
                }
                let named = schema
                    .and_then(|schema| property(schema, key))
                    .or_else(|| options(schema).find_map(|option| property(option, key)));
                let next = if path.is_empty() { key.clone() } else { format!("{path}.{key}") };
                resolved.insert(key.clone(), pointers(value, named, allowed, &next, source)?);
            }
            Ok(Value::Object(resolved))
        }
        Value::Array(items) => {
            let item = schema.and_then(|schema| schema.get("items")).filter(truthy);
            let next = format!("{path}[]");
            items.iter().map(|value| pointers(value, item, allowed, &next, source)).collect::<Result<_, _>>().map(Value::Array)
        }
        other => Ok(other.clone()),
    }
}

impl Lexicon {
    pub fn new() -> Lexicon {
        Lexicon { linked: HashMap::new(), groups: HashMap::new() }
    }

    /// Replace every schema link below `schema`, noting the paths that hold one.
    fn resolve(&mut self, schema: &Value, allowed: &mut Vec<String>, path: &str, schemas: &mut Schemas) -> Result<Value, String> {
        match schema {
            Value::Object(fields) => {
                if let Some(cid) = cid_link(fields) {
                    allowed.push(path.to_string());
                    let linked = self.link(cid, schemas).map_err(|error| format!("Failed to resolve schema CID: {error}"))?;
                    allowed.extend(linked.allowed.iter().map(|inner| join(path, inner)));
                    let nullable =
                        fields["type"].as_array().is_some_and(|kinds| kinds.len() > 1 && kinds.iter().any(|kind| kind == "null"));
                    return Ok(if nullable {
                        json!({ "anyOf": [{ "type": "null" }, linked.schema] })
                    } else {
                        linked.schema.clone()
                    });
                }
                let mut resolved = Map::with_capacity(fields.len());
                for (key, value) in fields {
                    let next = match (key.as_str(), value) {
                        ("properties", Value::Object(named)) => {
                            let mut properties = Map::with_capacity(named.len());
                            for (name, property) in named {
                                let inner = if path.is_empty() { name.clone() } else { format!("{path}.{name}") };
                                properties.insert(name.clone(), self.resolve(property, allowed, &inner, schemas)?);
                            }
                            Value::Object(properties)
                        }
                        ("items", _) => self.resolve(value, allowed, &format!("{path}[]"), schemas)?,
                        _ => self.resolve(value, allowed, path, schemas)?,
                    };
                    resolved.insert(key.clone(), next);
                }
                if fields.get("format").is_some_and(|format| format == "currency") {
                    resolved.insert("x-currency".to_string(), Value::Bool(true));
                }
                Ok(Value::Object(resolved))
            }
            Value::Array(items) => {
                let inner = format!("{path}[]");
                items.iter().map(|item| self.resolve(item, allowed, &inner, schemas)).collect::<Result<_, _>>().map(Value::Array)
            }
            other => Ok(other.clone()),
        }
    }

    /// A linked schema, resolved once per CID.
    fn link(&mut self, cid: &str, schemas: &mut Schemas) -> Result<Arc<Linked>, String> {
        if let Some(known) = self.linked.get(cid) {
            return Ok(known.clone());
        }
        let raw = schemas.get(cid).map_err(|error| format!("Failed to load schema from CID {cid}: {error}"))?;
        let mut allowed = Vec::new();
        let schema = self.resolve(&raw, &mut allowed, "", schemas)?;
        let linked = Arc::new(Linked { schema, allowed });
        self.linked.insert(cid.to_string(), linked.clone());
        Ok(linked)
    }

    /// A data group schema resolved and compiled, once per CID.
    pub fn group(&mut self, cid: &str, schemas: &mut Schemas) -> Arc<Group> {
        if let Some(known) = self.groups.get(cid) {
            return known.clone();
        }
        let group = Arc::new(match schemas.get(cid) {
            Err(reason) => Group::Missing(reason),
            Ok(raw) => {
                let properties = raw.get("properties").and_then(Value::as_object);
                let shaped = raw.get("type").is_some_and(|kind| kind == "object")
                    && properties.is_some_and(|properties| {
                        properties.len() == 2
                            && properties.get("label").as_ref().is_some_and(truthy)
                            && properties.get("relationships").as_ref().is_some_and(truthy)
                    });
                let mut allowed = Vec::new();
                match self.resolve(&raw, &mut allowed, "", schemas) {
                    _ if !shaped => Group::Invalid,
                    Err(error) => Group::Broken(error),
                    Ok(schema) => {
                        let built = jsonschema::options()
                            .with_draft(Draft::Draft7)
                            .should_validate_formats(true)
                            .with_format("cid", |value: &str| Cid::try_from(value).is_ok())
                            .with_format("ipfs_uri", ipfs_uri)
                            .with_format("rate_percent", |value: &str| RATE.is_match(value.as_bytes()))
                            .with_format("uri", |value: &str| URI.is_match(value.as_bytes()))
                            .with_keyword("x-currency", currency_keyword)
                            .build(&schema);
                        match built {
                            Err(error) => Group::Broken(error.to_string()),
                            Ok(validator) => {
                                Group::Ready { schema, allowed: allowed.into_iter().collect(), validator: Box::new(validator) }
                            }
                        }
                    }
                }
            }
        });
        self.groups.insert(cid.to_string(), group.clone());
        group
    }
}

impl Group {
    /// Validate one data group root. `None` when the schema cannot be used at
    /// all (`Missing` or `Invalid`); otherwise the schema errors found.
    pub fn validate<'a>(&self, data: &Value, source: Source<'_, 'a>) -> Option<Vec<Finding>> {
        let thrown =
            |error: &str| Finding { path: "root".to_string(), message: format!("Validation error: {error}"), value: text(data) };
        match self {
            Group::Missing(_) | Group::Invalid => None,
            Group::Broken(error) => Some(vec![thrown(error)]),
            Group::Ready { schema, allowed, validator } => {
                let resolved = match pointers(data, Some(schema), allowed, "", source) {
                    Err(error) => return Some(vec![thrown(&error)]),
                    Ok(resolved) => resolved,
                };
                let mut findings = Vec::new();
                validator.iter_errors(&resolved).for_each(|error| collect(&error, &mut findings));
                Some(findings)
            }
        }
    }
}

/// elephant-cli's `filterErrorRows`: drop bare type and anyOf/oneOf rows,
/// fold address rows of a failed address into one, then dedupe by message and
/// last path segment.
pub fn filter(entries: Vec<Row>) -> Vec<Row> {
    let mismatch = |message: &str| matches!(message, "must match a schema in anyOf" | "must match exactly one schema in oneOf");
    let address = |row: &Row| row.path.contains("property_has_address") && row.path.contains("/to");
    let mut failed = HashSet::new();
    let mut rows = Vec::new();
    for row in entries {
        if matches!(row.message.as_str(), "must be null" | "must be object" | "must be array") {
            continue;
        }
        if address(&row) && mismatch(&row.message) {
            failed.insert(row.file.clone());
        }
        if !mismatch(&row.message) {
            rows.push(row);
        }
    }
    let mut folded: Vec<Row> = Vec::new();
    let mut kept = Vec::new();
    for row in rows {
        if !(failed.contains(&row.file) && address(&row)) {
            kept.push(row);
            continue;
        }
        if folded.iter().all(|other| other.file != row.file) {
            folded.push(Row {
                path: "/relationships/property_has_address".to_string(),
                message: "Address should provide either unnormalized_address or normalized version distributed to other fields"
                    .to_string(),
                ..row
            });
        }
    }
    let mut seen = HashSet::new();
    kept.into_iter()
        .chain(folded)
        .filter(|row| {
            let last = row.path.split('/').rfind(|part| !part.is_empty()).unwrap_or("root");
            seen.insert(format!("{}::{last}", row.message))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, message: &str) -> Row {
        Row { file: "b".to_string(), path: path.to_string(), message: message.to_string(), ..Row::default() }
    }

    #[test]
    fn folds_a_failed_address_into_one_row_and_drops_bare_type_rows() {
        let kept = filter(vec![
            row("/relationships/property_has_address/to", "must match exactly one schema in oneOf"),
            row("/relationships/property_has_address/to", "missing required property 'city'"),
            row("/relationships/property_has_address/to/zip", "must be null"),
            row("/label", "must be one of: a, b"),
            row("/other/label", "must be one of: a, b"),
        ]);
        let found: Vec<_> = kept.iter().map(|row| (row.path.as_str(), row.message.as_str())).collect();
        assert_eq!(
            found,
            [
                ("/label", "must be one of: a, b"),
                (
                    "/relationships/property_has_address",
                    "Address should provide either unnormalized_address or normalized version distributed to other fields"
                ),
            ]
        );
    }

    #[test]
    fn replaces_a_pointer_only_where_the_schema_links() {
        let allowed: HashSet<String> = ["a".to_string()].into();
        let source = |_: &str| Ok(Cow::Owned(json!({ "x": 1 })));
        let cid = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
        let data = json!({ "a": { "/": cid }, "b": { "/": cid } });
        let resolved = pointers(&data, None, &allowed, "", &source).unwrap();
        assert_eq!(resolved, json!({ "a": { "x": 1 }, "b": { "/": cid } }));
        let gone = |pointer: &str| Err(format!("block {pointer} is not in the car"));
        let missing = pointers(&data, None, &allowed, "", &gone).unwrap_err();
        assert_eq!(missing, format!("Failed to resolve CID pointer: block {cid} is not in the car"));
    }
}
