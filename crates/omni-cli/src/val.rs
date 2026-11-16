//! Reading the API's JSON the way the TypeScript command does: a missing field is `undefined`, a test is
//! JavaScript's truthiness, and text put into a line is `String(value)`.

use omni_core::js::{self, JsObject, JsValue};

use crate::error::{Error, Result};

/// A field that is there and not null: what `a.b ?? fallback` keeps.
pub fn field<'a>(value: &'a JsValue, key: &str) -> Option<&'a JsValue> {
    value.get(key).filter(|v| !matches!(v, JsValue::Null))
}

/// A part of the answer the command cannot do without.
pub fn part<'a>(value: &'a JsValue, key: &str) -> Result<&'a JsValue> {
    field(value, key)
        .ok_or_else(|| Error::cli(format!("Omni's answer has no \"{key}\". Is this command older or newer than the Omni it asked?")))
}

/// A field as text: a string as it is, nothing as empty, anything else as JavaScript prints it.
pub fn text(value: &JsValue, key: &str) -> String {
    field(value, key).map(|v| v.to_js_string().to_string_lossy()).unwrap_or_default()
}

/// A field inside a template literal: `undefined` and `null` print as those words.
pub fn shown(value: &JsValue, key: &str) -> String {
    js::to_js_string(value.get(key)).to_string_lossy()
}

/// A field when it is truthy, as text.
pub fn truthy_text(value: &JsValue, key: &str) -> Option<String> {
    value.get(key).filter(|v| v.is_truthy()).map(|v| v.to_js_string().to_string_lossy())
}

pub fn truthy(value: &JsValue, key: &str) -> bool {
    value.get(key).is_some_and(JsValue::is_truthy)
}

/// A field equal to this text, as `===` decides.
pub fn is(value: &JsValue, key: &str, expected: &str) -> bool {
    value.get(key).and_then(JsValue::as_js_string).is_some_and(|s| s.eq_str(expected))
}

/// A field that is a list, or no items.
pub fn list<'a>(value: &'a JsValue, key: &str) -> &'a [JsValue] {
    value.get(key).and_then(JsValue::as_array).unwrap_or_default()
}

pub fn number(value: &JsValue, key: &str) -> Option<f64> {
    value.get(key).and_then(JsValue::as_f64)
}

/// An object as `JSON.stringify` prints one: a key whose value is `undefined` is left out.
pub fn object(pairs: Vec<(&str, Option<JsValue>)>) -> JsValue {
    let mut out = JsObject::new();
    for (key, value) in pairs {
        if let Some(value) = value {
            out.set(key, value);
        }
    }
    JsValue::Object(out)
}

pub fn string(text: &str) -> Option<JsValue> {
    Some(JsValue::str(text))
}

/// A value, or `null` where there is none.
pub fn or_null(value: Option<JsValue>) -> Option<JsValue> {
    Some(value.unwrap_or(JsValue::Null))
}

/// `JSON.stringify(value, null, 2)` and a newline.
pub fn json(value: &JsValue) -> String {
    format!("{}\n", js::stringify_pretty(value))
}
