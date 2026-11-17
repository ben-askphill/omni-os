//! The part of zod 4 the servers' schemas use, ported so a call the TypeScript servers refused is refused here with
//! the same words, and a tool's input schema lists the same JSON.
//!
//! What it keeps from zod, because agents read the result:
//! - Fields are checked in the order the schema names them, and an optional one is skipped only when absent.
//! - A value of the wrong type that still has a `length` is measured too, so one value can raise two issues.
//! - A number that is not whole stops its later checks; one that is whole but beyond the safe range does not.
//! - What the schema does not name is left out of the parsed value.

use omni_core::js::{self, JsObject, JsString, JsValue};

/// `Number.MAX_SAFE_INTEGER`.
pub const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

pub enum Schema {
    String {
        min: Option<usize>,
        max: Option<usize>,
    },
    Number {
        int: bool,
        min: Option<f64>,
        max: Option<f64>,
    },
    Boolean,
    Array {
        items: Box<Schema>,
        min: Option<usize>,
        max: Option<usize>,
    },
    Object(Vec<Field>),
    /// `z.record(z.string(), z.unknown())`: any plain object, kept whole.
    Record,
}

impl Schema {
    pub fn string() -> Self {
        Self::String { min: None, max: None }
    }

    pub fn int() -> Self {
        Self::Number { int: true, min: None, max: None }
    }

    pub fn number() -> Self {
        Self::Number { int: false, min: None, max: None }
    }

    pub fn array(items: Schema) -> Self {
        Self::Array { items: Box::new(items), min: None, max: None }
    }

    /// A length for a string or an array, a value for a number.
    pub fn min(mut self, least: u32) -> Self {
        match &mut self {
            Self::String { min, .. } | Self::Array { min, .. } => *min = Some(least as usize),
            Self::Number { min, .. } => *min = Some(f64::from(least)),
            Self::Boolean | Self::Object(_) | Self::Record => {}
        }
        self
    }

    pub fn max(mut self, most: u32) -> Self {
        match &mut self {
            Self::String { max, .. } | Self::Array { max, .. } => *max = Some(most as usize),
            Self::Number { max, .. } => *max = Some(f64::from(most)),
            Self::Boolean | Self::Object(_) | Self::Record => {}
        }
        self
    }
}

pub struct Field {
    pub name: &'static str,
    pub schema: Schema,
    pub optional: bool,
    pub description: Option<String>,
}

impl Field {
    pub fn new(name: &'static str, schema: Schema) -> Self {
        Self { name, schema, optional: false, description: None }
    }

    pub fn optional(mut self) -> Self {
        self.optional = true;
        self
    }

    pub fn describe(mut self, text: impl Into<String>) -> Self {
        self.description = Some(text.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Key {
    Name(&'static str),
    Index(usize),
}

#[derive(Debug, Clone, PartialEq)]
enum Kind {
    /// `received` is set only where zod names it in the issue itself: a number that is not finite.
    InvalidType {
        expected: &'static str,
        received: Option<String>,
        format: Option<&'static str>,
    },
    TooBig {
        origin: &'static str,
        maximum: f64,
    },
    TooSmall {
        origin: &'static str,
        minimum: f64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    pub path: Vec<Key>,
    pub message: String,
    kind: Kind,
}

/// What zod's English messages call a value.
fn type_name(value: Option<&JsValue>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(JsValue::Null) => "null".to_owned(),
        Some(JsValue::Bool(_)) => "boolean".to_owned(),
        Some(JsValue::Number(n)) if !n.is_finite() => js::number_to_string(*n),
        Some(JsValue::Number(_)) => "number".to_owned(),
        Some(JsValue::String(_)) => "string".to_owned(),
        Some(JsValue::Array(_)) => "array".to_owned(),
        Some(JsValue::Object(_)) => "object".to_owned(),
    }
}

/// The unit a size is counted in, for what has one.
fn unit(origin: &str) -> Option<&'static str> {
    match origin {
        "string" => Some("characters"),
        "array" => Some("items"),
        _ => None,
    }
}

struct Run {
    path: Vec<Key>,
    issues: Vec<Issue>,
}

impl Run {
    fn invalid_type(&mut self, expected: &'static str, value: Option<&JsValue>) {
        let received = match value {
            Some(JsValue::Number(n)) if !n.is_finite() => Some(js::number_to_string(*n)),
            _ => None,
        };
        let message = format!("Invalid input: expected {expected}, received {}", type_name(value));
        self.issues.push(Issue { path: self.path.clone(), message, kind: Kind::InvalidType { expected, received, format: None } });
    }

    fn too_small(&mut self, origin: &'static str, minimum: f64) {
        let least = js::number_to_string(minimum);
        let message = match unit(origin) {
            Some(unit) => format!("Too small: expected {origin} to have >={least} {unit}"),
            None => format!("Too small: expected {origin} to be >={least}"),
        };
        self.issues.push(Issue { path: self.path.clone(), message, kind: Kind::TooSmall { origin, minimum } });
    }

    fn too_big(&mut self, origin: &'static str, maximum: f64) {
        let most = js::number_to_string(maximum);
        let message = match unit(origin) {
            Some(unit) => format!("Too big: expected {origin} to have <={most} {unit}"),
            None => format!("Too big: expected {origin} to be <={most}"),
        };
        self.issues.push(Issue { path: self.path.clone(), message, kind: Kind::TooBig { origin, maximum } });
    }

    /// zod's length checks. They run on whatever has a `length`, whether or not it is the type the schema asked for:
    /// a string, an array, or an object with a property of that name.
    fn lengths(&mut self, value: Option<&JsValue>, min: Option<usize>, max: Option<usize>) {
        let (origin, units, text) = match value {
            Some(JsValue::String(s)) => ("string", s.len() as f64, Some(s)),
            Some(JsValue::Array(items)) => ("array", items.len() as f64, None),
            Some(JsValue::Object(object)) => match object.get("length") {
                Some(length) => ("unknown", js::to_number(Some(length)), None),
                None => return,
            },
            _ => return,
        };
        // A string is measured in code points, counted only where the count of UTF-16 units leaves it in doubt.
        if let Some(min) = min {
            let least = min as f64;
            let length = match text {
                Some(s) if units >= least && units < least * 2.0 => s.code_points() as f64,
                _ => units,
            };
            // A length that is no number fails both ways, as it does in zod.
            if length.is_nan() || length < least {
                self.too_small(origin, least);
            }
        }
        if let Some(max) = max {
            let most = max as f64;
            let length = match text {
                Some(s) if units > most => s.code_points() as f64,
                _ => units,
            };
            if length.is_nan() || length > most {
                self.too_big(origin, most);
            }
        }
    }

    fn value(&mut self, schema: &Schema, value: Option<&JsValue>) -> Option<JsValue> {
        match schema {
            Schema::String { min, max } => {
                let text = value.filter(|v| matches!(v, JsValue::String(_)));
                if text.is_none() {
                    self.invalid_type("string", value);
                }
                self.lengths(value, *min, *max);
                text.cloned()
            }
            Schema::Number { int, min, max } => {
                let Some(n) = value.and_then(JsValue::as_f64).filter(|n| n.is_finite()) else {
                    self.invalid_type("number", value);
                    return None;
                };
                if *int {
                    if n.fract() != 0.0 {
                        let message = "Invalid input: expected int, received number".to_owned();
                        let kind = Kind::InvalidType { expected: "int", received: None, format: Some("safeint") };
                        self.issues.push(Issue { path: self.path.clone(), message, kind });
                        return None;
                    }
                    if n > MAX_SAFE_INTEGER {
                        self.too_big("int", MAX_SAFE_INTEGER);
                    } else if n < -MAX_SAFE_INTEGER {
                        self.too_small("int", -MAX_SAFE_INTEGER);
                    }
                }
                if min.is_some_and(|least| n < least) {
                    self.too_small("number", min.unwrap_or_default());
                }
                if max.is_some_and(|most| n > most) {
                    self.too_big("number", max.unwrap_or_default());
                }
                value.cloned()
            }
            Schema::Boolean => {
                let flag = value.filter(|v| matches!(v, JsValue::Bool(_)));
                if flag.is_none() {
                    self.invalid_type("boolean", value);
                }
                flag.cloned()
            }
            Schema::Array { items, min, max } => {
                let Some(JsValue::Array(list)) = value else {
                    self.invalid_type("array", value);
                    self.lengths(value, *min, *max);
                    return None;
                };
                let mut out = Vec::with_capacity(list.len());
                for (i, item) in list.iter().enumerate() {
                    self.path.push(Key::Index(i));
                    out.extend(self.value(items, Some(item)));
                    self.path.pop();
                }
                self.lengths(value, *min, *max);
                Some(JsValue::Array(out))
            }
            Schema::Object(fields) => {
                let Some(JsValue::Object(input)) = value else {
                    self.invalid_type("object", value);
                    return None;
                };
                Some(JsValue::Object(self.fields(fields, input)))
            }
            Schema::Record => {
                let record = value.filter(|v| matches!(v, JsValue::Object(_)));
                if record.is_none() {
                    self.invalid_type("record", value);
                }
                record.cloned()
            }
        }
    }

    fn fields(&mut self, fields: &[Field], input: &JsObject) -> JsObject {
        let mut out = JsObject::new();
        for field in fields {
            let item = input.get(field.name);
            if item.is_none() && field.optional {
                continue;
            }
            self.path.push(Key::Name(field.name));
            if let Some(parsed) = self.value(&field.schema, item) {
                out.set(field.name, parsed);
            }
            self.path.pop();
        }
        out
    }
}

/// The value as the schema reads it, or every issue it found. `None` is JavaScript's `undefined`. Paths start at
/// `under`, which is where the value sits in what the caller sent.
pub fn parse(schema: &Schema, value: Option<&JsValue>, under: &[Key]) -> Result<JsValue, Vec<Issue>> {
    let mut run = Run { path: under.to_vec(), issues: Vec::new() };
    let parsed = run.value(schema, value);
    match parsed {
        Some(parsed) if run.issues.is_empty() => Ok(parsed),
        _ => Err(run.issues),
    }
}

/// One line per issue with where it is, as the MCP SDK words a tool call it refuses: `questions[0].options[1].label`.
pub fn lines(issues: &[Issue]) -> String {
    let line = |issue: &Issue| {
        if issue.path.is_empty() {
            return issue.message.clone();
        }
        let mut at = String::new();
        for key in &issue.path {
            match key {
                Key::Name(name) if at.is_empty() => at.push_str(name),
                Key::Name(name) => {
                    at.push('.');
                    at.push_str(name);
                }
                Key::Index(i) => at.push_str(&format!("[{i}]")),
            }
        }
        format!("{} at {at}", issue.message)
    };
    issues.iter().map(line).collect::<Vec<_>>().join("\n")
}

/// The issues as zod's own error message lists them: `JSON.stringify(issues, null, 2)`.
pub fn dump(issues: &[Issue]) -> String {
    let entry = |issue: &Issue| {
        let mut out = JsObject::new();
        match &issue.kind {
            Kind::InvalidType { expected, received, format } => {
                out.set("expected", JsValue::str(expected));
                if let Some(format) = format {
                    out.set("format", JsValue::str(format));
                }
                out.set("code", JsValue::str("invalid_type"));
                if let Some(received) = received {
                    out.set("received", JsValue::str(received));
                }
            }
            Kind::TooBig { origin, maximum } => {
                out.set("origin", JsValue::str(origin));
                out.set("code", JsValue::str("too_big"));
                out.set("maximum", JsValue::Number(*maximum));
                out.set("inclusive", JsValue::Bool(true));
            }
            Kind::TooSmall { origin, minimum } => {
                out.set("origin", JsValue::str(origin));
                out.set("code", JsValue::str("too_small"));
                out.set("minimum", JsValue::Number(*minimum));
                out.set("inclusive", JsValue::Bool(true));
            }
        }
        let key = |key: &Key| match key {
            Key::Name(name) => JsValue::str(name),
            Key::Index(i) => JsValue::Number(*i as f64),
        };
        out.set("path", JsValue::Array(issue.path.iter().map(key).collect()));
        out.set("message", JsValue::String(JsString::from(issue.message.as_str())));
        JsValue::Object(out)
    };
    js::stringify_pretty(&JsValue::Array(issues.iter().map(entry).collect()))
}

fn schema_json(schema: &Schema) -> JsObject {
    let mut out = JsObject::new();
    let count = |n: usize| JsValue::Number(n as f64);
    match schema {
        Schema::String { min, max } => {
            out.set("type", JsValue::str("string"));
            if let Some(min) = min {
                out.set("minLength", count(*min));
            }
            if let Some(max) = max {
                out.set("maxLength", count(*max));
            }
        }
        Schema::Number { int: true, min, max } => {
            out.set("type", JsValue::str("integer"));
            out.set("minimum", JsValue::Number(min.unwrap_or(-MAX_SAFE_INTEGER)));
            out.set("maximum", JsValue::Number(max.unwrap_or(MAX_SAFE_INTEGER)));
        }
        Schema::Number { int: false, min, max } => {
            out.set("type", JsValue::str("number"));
            if let Some(min) = min {
                out.set("minimum", JsValue::Number(*min));
            }
            if let Some(max) = max {
                out.set("maximum", JsValue::Number(*max));
            }
        }
        Schema::Boolean => out.set("type", JsValue::str("boolean")),
        Schema::Array { items, min, max } => {
            if let Some(min) = min {
                out.set("minItems", count(*min));
            }
            if let Some(max) = max {
                out.set("maxItems", count(*max));
            }
            out.set("type", JsValue::str("array"));
            out.set("items", JsValue::Object(schema_json(items)));
        }
        Schema::Object(fields) => object_json(&mut out, fields),
        Schema::Record => {
            out.set("type", JsValue::str("object"));
            out.set("propertyNames", JsValue::object([("type", JsValue::str("string"))]));
            out.set("additionalProperties", JsValue::Object(JsObject::new()));
        }
    }
    out
}

fn object_json(out: &mut JsObject, fields: &[Field]) {
    let mut properties = JsObject::new();
    for field in fields {
        let inner = schema_json(&field.schema);
        let description = field.description.as_deref().map(|text| JsValue::String(JsString::from(text)));
        // zod writes an optional field's description before what it describes, and a required one's after.
        let mut property = JsObject::new();
        if let (true, Some(text)) = (field.optional, &description) {
            property.set("description", text.clone());
        }
        for (key, value) in inner.iter() {
            property.set(key.clone(), value.clone());
        }
        if let (false, Some(text)) = (field.optional, description) {
            property.set("description", text);
        }
        properties.set(field.name, JsValue::Object(property));
    }
    out.set("type", JsValue::str("object"));
    out.set("properties", JsValue::Object(properties));
    let required: Vec<JsValue> = fields.iter().filter(|f| !f.optional).map(|f| JsValue::str(f.name)).collect();
    if !required.is_empty() {
        out.set("required", JsValue::Array(required));
    }
}

/// A tool's input as the JSON Schema `tools/list` shows: draft 7, as zod's `toJSONSchema` writes it for the SDK.
pub fn input_schema(fields: &[Field]) -> JsValue {
    let mut out = JsObject::new();
    out.set("$schema", JsValue::str("http://json-schema.org/draft-07/schema#"));
    object_json(&mut out, fields);
    JsValue::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refuse(schema: &Schema, json: &str) -> String {
        let value = js::parse(json).expect(json);
        lines(&parse(schema, Some(&value), &[]).expect_err(json))
    }

    fn page() -> Schema {
        Schema::Object(vec![
            Field::new("title", Schema::string().min(1).max(4)),
            Field::new("limit", Schema::int().min(1).max(100)).optional(),
        ])
    }

    #[test]
    fn a_valid_value_keeps_only_what_the_schema_names_in_its_order() {
        let value = js::parse(r#"{"more":1,"limit":5,"title":"T"}"#).unwrap();
        let parsed = parse(&page(), Some(&value), &[]).unwrap();
        assert_eq!(js::stringify(&parsed), r#"{"title":"T","limit":5}"#);
    }

    #[test]
    fn an_optional_field_may_be_absent_but_not_null() {
        assert!(parse(&page(), Some(&js::parse(r#"{"title":"T"}"#).unwrap()), &[]).is_ok());
        assert_eq!(refuse(&page(), r#"{"title":"T","limit":null}"#), "Invalid input: expected number, received null at limit");
    }

    #[test]
    fn a_string_is_measured_in_code_points() {
        // Four emoji are eight UTF-16 units and four characters.
        assert!(parse(&page(), Some(&js::parse(r#"{"title":"😀😀😀😀"}"#).unwrap()), &[]).is_ok());
        assert_eq!(refuse(&page(), r#"{"title":"😀😀😀😀😀"}"#), "Too big: expected string to have <=4 characters at title");
        assert_eq!(refuse(&page(), r#"{"title":""}"#), "Too small: expected string to have >=1 characters at title");
    }

    #[test]
    fn a_wrong_type_with_a_length_is_measured_as_what_it_is() {
        assert_eq!(
            refuse(&page(), r#"{"title":[]}"#),
            "Invalid input: expected string, received array at title\nToo small: expected array to have >=1 items at title"
        );
        assert_eq!(
            refuse(&page(), r#"{"title":{"length":"many"}}"#),
            "Invalid input: expected string, received object at title\nToo small: expected unknown to be >=1 at title\nToo big: expected unknown to be <=4 at title"
        );
        assert_eq!(refuse(&page(), r#"{"title":{"length":"3"}}"#), "Invalid input: expected string, received object at title");
    }

    #[test]
    fn a_fraction_stops_the_checks_after_it_and_an_unsafe_whole_number_does_not() {
        assert_eq!(refuse(&page(), r#"{"title":"T","limit":-1.5}"#), "Invalid input: expected int, received number at limit");
        assert_eq!(
            refuse(&page(), r#"{"title":"T","limit":1e300}"#),
            "Too big: expected int to be <=9007199254740991 at limit\nToo big: expected number to be <=100 at limit"
        );
        assert_eq!(refuse(&page(), r#"{"title":"T","limit":1e400}"#), "Invalid input: expected number, received Infinity at limit");
    }

    #[test]
    fn issues_dump_as_zod_lists_them() {
        let schema = Schema::Object(vec![Field::new("ttl", Schema::number()).optional()]);
        let issues = parse(&schema, Some(&js::parse(r#"{"ttl":-1e400}"#).unwrap()), &[Key::Name("params"), Key::Name("task")]).unwrap_err();
        assert_eq!(
            dump(&issues),
            "[\n  {\n    \"expected\": \"number\",\n    \"code\": \"invalid_type\",\n    \"received\": \"-Infinity\",\n    \"path\": [\n      \"params\",\n      \"task\",\n      \"ttl\"\n    ],\n    \"message\": \"Invalid input: expected number, received -Infinity\"\n  }\n]"
        );
    }

    #[test]
    fn the_input_schema_orders_its_keys_as_zod_does() {
        let fields = [
            Field::new("title", Schema::string().min(1).max(200)).describe("A name."),
            Field::new("tags", Schema::array(Schema::string()).min(2)).optional().describe("Some tags."),
            Field::new("limit", Schema::int().min(1)).optional(),
        ];
        assert_eq!(
            js::stringify(&input_schema(&fields)),
            concat!(
                r#"{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"#,
                r#""title":{"type":"string","minLength":1,"maxLength":200,"description":"A name."},"#,
                r#""tags":{"description":"Some tags.","minItems":2,"type":"array","items":{"type":"string"}},"#,
                r#""limit":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["title"]}"#
            )
        );
    }
}
