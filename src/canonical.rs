//! The canonical bytes of a JSON block: RFC 8785 (JCS) after elephant's link
//! sort, exactly as elephant-cli 1.x wrote them, so CIDs stay the same.

use crate::cids::order;
use serde_json::Value;

/// A link as the sort sees it: an object holding only `"/"` with a string.
fn link(value: &Value) -> Option<&str> {
    value.as_object().filter(|fields| fields.len() == 1)?.get("/")?.as_str()
}

fn write(value: &Value, out: &mut String) {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => out.push_str(&value.to_string()),
        // Every number goes through a double and prints as ECMAScript prints it.
        Value::Number(number) => out.push_str(ryu_js::Buffer::new().format(number.as_f64().unwrap_or(0.0))),
        Value::Array(items) => {
            // An array holding links lists them first, ordered by target; the rest keep their order.
            // ponytail: byte order where 1.x used locale collation; the same for CIDs
            let mut sorted: Vec<&Value> = items.iter().collect();
            if items.iter().any(|item| link(item).is_some()) {
                sorted.sort_by(|a, b| match (link(a), link(b)) {
                    (Some(a), Some(b)) => a.cmp(b),
                    (a, b) => b.is_some().cmp(&a.is_some()),
                });
            }
            out.push('[');
            for (at, item) in sorted.into_iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                write(item, out);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            // 1.x rebuilt objects key by key in JavaScript, which loses `__proto__`.
            let mut keys: Vec<&String> = fields.keys().filter(|key| *key != "__proto__").collect();
            keys.sort_by(|a, b| order(a, b));
            out.push('{');
            for (at, key) in keys.into_iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                write(&fields[key], out);
            }
            out.push('}');
        }
    }
}

fn plain(value: &Value, out: &mut String) {
    match value {
        Value::Number(number) => out.push_str(ryu_js::Buffer::new().format(number.as_f64().unwrap_or(0.0))),
        Value::Array(items) => {
            out.push('[');
            for (at, item) in items.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                plain(item, out);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            out.push('{');
            for (at, (key, item)) in fields.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                plain(item, out);
            }
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

/// A value as JavaScript's `JSON.stringify` prints it: compact, keys in the order held.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    plain(value, &mut out);
    out
}

fn indented(value: &Value, depth: usize, out: &mut String) {
    let pad = |depth: usize, out: &mut String| out.push_str(&"  ".repeat(depth));
    match value {
        Value::Array(items) if !items.is_empty() => {
            out.push_str("[\n");
            for (at, item) in items.iter().enumerate() {
                pad(depth + 1, out);
                indented(item, depth + 1, out);
                out.push_str(if at + 1 < items.len() { ",\n" } else { "\n" });
            }
            pad(depth, out);
            out.push(']');
        }
        Value::Object(fields) if !fields.is_empty() => {
            out.push_str("{\n");
            for (at, (key, item)) in fields.iter().enumerate() {
                pad(depth + 1, out);
                out.push_str(&Value::String(key.clone()).to_string());
                out.push_str(": ");
                indented(item, depth + 1, out);
                out.push_str(if at + 1 < fields.len() { ",\n" } else { "\n" });
            }
            pad(depth, out);
            out.push('}');
        }
        other => plain(other, out),
    }
}

/// A value as JavaScript's `JSON.stringify(value, null, 2)` prints it.
pub fn pretty(value: &Value) -> String {
    let mut out = String::new();
    indented(value, 0, &mut out);
    out
}

pub fn canonical(value: &Value) -> String {
    let mut out = String::new();
    write(value, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::canonical;
    use serde_json::{json, Value};

    fn of(text: &str) -> String {
        canonical(&serde_json::from_str::<Value>(text).unwrap())
    }

    /// Number spellings elephant-cli 1.58.1 produced (verified by running it).
    #[test]
    fn prints_numbers_as_ecmascript_does() {
        for (written, expected) in [
            ("1.0", "1"),
            ("-0", "0"),
            ("1E2", "100"),
            ("1e21", "1e+21"),
            ("0.1e-6", "1e-7"),
            ("-81.8723100", "-81.87231"),
            ("123456789012345678901234567890", "1.2345678901234568e+29"),
            ("0.30000000000000004", "0.30000000000000004"),
        ] {
            assert_eq!(of(written), expected, "{written}");
        }
    }

    #[test]
    fn sorts_keys_by_utf16_code_units_and_drops_proto() {
        let written = r#"{"é":0,"😀":"😀","aa":1,"a":2,"B":3,"10":4,"9":5,"":6,"__proto__":7}"#;
        assert_eq!(of(written), r#"{"":6,"10":4,"9":5,"B":3,"a":2,"aa":1,"é":0,"😀":"😀"}"#);
    }

    #[test]
    fn lists_links_first_by_target_and_keeps_the_rest_in_order() {
        let value = json!([3, {"/": "b"}, "x", {"/": "a"}, {"/": "a", "more": 1}]);
        assert_eq!(canonical(&value), r#"[{"/":"a"},{"/":"b"},3,"x",{"/":"a","more":1}]"#);
        assert_eq!(canonical(&json!([2, 1, "b", "a"])), r#"[2,1,"b","a"]"#);
    }

    #[test]
    fn prints_indented_json_as_json_stringify_does() {
        let value = json!({"a": [1.0, {"b": []}, {}], "c": 1e21, "d": "x"});
        assert_eq!(
            super::pretty(&value),
            "{\n  \"a\": [\n    1,\n    {\n      \"b\": []\n    },\n    {}\n  ],\n  \"c\": 1e+21,\n  \"d\": \"x\"\n}"
        );
        assert_eq!(super::stringify(&value), r#"{"a":[1,{"b":[]},{}],"c":1e+21,"d":"x"}"#);
    }

    #[test]
    fn escapes_strings_as_json_stringify_does() {
        assert_eq!(canonical(&json!("a\"\\\u{8}\u{c}\n\r\t\u{1f}/\u{7f}é")), "\"a\\\"\\\\\\b\\f\\n\\r\\t\\u001f/\u{7f}é\"");
    }
}
