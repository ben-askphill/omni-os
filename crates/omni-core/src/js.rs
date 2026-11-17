//! JSON as JavaScript reads and writes it.
//!
//! Omni's server and clients are JavaScript, and a native binary that replaces a Node script has to send and answer
//! the same bytes that script did. Three things in JavaScript's JSON differ from what a Rust JSON library does, and
//! each one shows up in real traffic:
//!
//! - A string is UTF-16 and may hold half of a surrogate pair. The server cuts long messages at a character count,
//!   which can split an emoji, and `JSON.stringify` writes the half as `\ud83d`. A Rust `String` cannot hold it.
//! - A number prints the way `Number.prototype.toString` prints it: `1`, never `1.0`, and `1e+21`.
//! - An object lists integer-like keys first, in numeric order, then the rest in the order they were added.
//!
//! [`parse`] follows `JSON.parse` and [`stringify`] and [`stringify_pretty`] follow `JSON.stringify(v)` and
//! `JSON.stringify(v, null, 2)`. `tests/node_parity.rs` checks them against what Node printed for the same input.

use std::collections::HashMap;
use std::fmt;

/// A JavaScript string: UTF-16 code units, which may include a lone surrogate.
#[derive(Clone, PartialEq, Eq, Hash, Default)]
pub struct JsString(Vec<u16>);

impl JsString {
    pub fn from_units(units: Vec<u16>) -> Self {
        Self(units)
    }

    pub fn units(&self) -> &[u16] {
        &self.0
    }

    /// The string's `.length`: UTF-16 code units, not characters or bytes.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// As text, with U+FFFD for a lone surrogate. This is also what Node writes when it encodes the string as UTF-8.
    pub fn to_string_lossy(&self) -> String {
        String::from_utf16_lossy(&self.0)
    }

    /// `String.prototype.trim`.
    pub fn trim(&self) -> JsString {
        let start = self.0.iter().position(|&u| !is_space(u)).unwrap_or(self.0.len());
        let end = self.0.iter().rposition(|&u| !is_space(u)).map_or(start, |i| i + 1);
        JsString(self.0[start..end].to_vec())
    }

    pub fn eq_str(&self, other: &str) -> bool {
        self.0.iter().copied().eq(other.encode_utf16())
    }

    pub fn push_str(&mut self, text: &str) {
        self.0.extend(text.encode_utf16());
    }

    pub fn push_js(&mut self, text: &JsString) {
        self.0.extend_from_slice(&text.0);
    }

    /// How many code points: a surrogate pair counts once, a lone half counts as one.
    pub fn code_points(&self) -> usize {
        char::decode_utf16(self.0.iter().copied()).count()
    }

    /// As text, or `None` when a lone surrogate makes it no Unicode text at all.
    pub fn to_text(&self) -> Option<String> {
        String::from_utf16(&self.0).ok()
    }
}

/// `encodeURIComponent`. `None` where JavaScript throws a `URIError`: the text holds a lone surrogate.
pub fn encode_uri_component(text: &JsString) -> Option<String> {
    let text = text.to_text()?;
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    Some(out)
}

/// WhiteSpace and LineTerminator of the ECMAScript grammar, which is what `trim` removes and `\s` matches. All of
/// them are one unit.
pub fn is_space(unit: u16) -> bool {
    matches!(
        unit,
        0x0009..=0x000D | 0x0020 | 0x00A0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

/// `String.prototype.trim` on text that is already a Rust string.
pub fn trim_str(text: &str) -> &str {
    text.trim_matches(|c: char| u16::try_from(c as u32).is_ok_and(is_space))
}

impl From<&str> for JsString {
    fn from(text: &str) -> Self {
        Self(text.encode_utf16().collect())
    }
}

impl From<String> for JsString {
    fn from(text: String) -> Self {
        Self::from(text.as_str())
    }
}

impl fmt::Display for JsString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_string_lossy())
    }
}

impl fmt::Debug for JsString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.to_string_lossy(), f)
    }
}

/// A JSON value with JavaScript's semantics.
#[derive(Clone, PartialEq, Debug)]
pub enum JsValue {
    Null,
    Bool(bool),
    Number(f64),
    String(JsString),
    Array(Vec<JsValue>),
    Object(JsObject),
}

/// An object's own properties in JavaScript's order: integer-like keys ascending, then the rest as added.
#[derive(Clone, Debug, Default)]
pub struct JsObject {
    entries: Vec<(JsString, JsValue)>,
    /// How many of the leading entries are integer-like keys.
    indexed: usize,
}

/// Equal when they hold the same keys with equal values, in any order.
impl PartialEq for JsObject {
    fn eq(&self, other: &Self) -> bool {
        self.entries.len() == other.entries.len() && self.entries.iter().all(|(k, v)| other.get_js(k) == Some(v))
    }
}

/// A canonical array index, the keys JavaScript orders first: `0`, or digits with no leading zero, below 2^32 - 1.
fn array_index(key: &JsString) -> Option<u32> {
    let units = key.units();
    if units.is_empty() || units.len() > 10 || (units.len() > 1 && units[0] == u16::from(b'0')) {
        return None;
    }
    let mut n: u64 = 0;
    for &u in units {
        if !(u16::from(b'0')..=u16::from(b'9')).contains(&u) {
            return None;
        }
        n = n * 10 + u64::from(u - u16::from(b'0'));
    }
    if n < u64::from(u32::MAX) { Some(n as u32) } else { None }
}

impl JsObject {
    pub fn new() -> Self {
        Self::default()
    }

    /// From properties in the order a JSON text listed them. A repeated key keeps its first place and its last value.
    fn from_listed(listed: Vec<(JsString, JsValue)>) -> Self {
        let mut seen: HashMap<JsString, usize> = HashMap::with_capacity(listed.len());
        let mut entries: Vec<(JsString, JsValue)> = Vec::with_capacity(listed.len());
        for (key, value) in listed {
            match seen.get(&key) {
                Some(&at) => entries[at].1 = value,
                None => {
                    seen.insert(key.clone(), entries.len());
                    entries.push((key, value));
                }
            }
        }
        let (mut indexed, named): (Vec<_>, Vec<_>) = entries.into_iter().partition(|(k, _)| array_index(k).is_some());
        indexed.sort_by_key(|(k, _)| array_index(k));
        let count = indexed.len();
        indexed.extend(named);
        Self { entries: indexed, indexed: count }
    }

    /// Sets a property as an assignment does: a new key goes where JavaScript would list it.
    pub fn set(&mut self, key: impl Into<JsString>, value: JsValue) {
        let key = key.into();
        if let Some(slot) = self.entries.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = value;
            return;
        }
        match array_index(&key) {
            Some(n) => {
                let at = self.entries[..self.indexed].partition_point(|(k, _)| array_index(k) < Some(n));
                self.entries.insert(at, (key, value));
                self.indexed += 1;
            }
            None => self.entries.push((key, value)),
        }
    }

    pub fn get(&self, key: &str) -> Option<&JsValue> {
        self.entries.iter().find(|(k, _)| k.eq_str(key)).map(|(_, v)| v)
    }

    pub fn get_js(&self, key: &JsString) -> Option<&JsValue> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&JsString, &JsValue)> {
        self.entries.iter().map(|(k, v)| (k, v))
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl JsValue {
    pub fn str(text: &str) -> Self {
        Self::String(JsString::from(text))
    }

    /// An object from `(key, value)` pairs.
    pub fn object<K: Into<JsString>>(pairs: impl IntoIterator<Item = (K, JsValue)>) -> Self {
        let mut object = JsObject::new();
        for (key, value) in pairs {
            object.set(key, value);
        }
        Self::Object(object)
    }

    /// A property of an object. `None` is JavaScript's `undefined`: no such key, or not an object.
    pub fn get(&self, key: &str) -> Option<&JsValue> {
        match self {
            Self::Object(object) => object.get(key),
            _ => None,
        }
    }

    pub fn as_js_string(&self) -> Option<&JsString> {
        match self {
            Self::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[JsValue]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&JsObject> {
        match self {
            Self::Object(object) => Some(object),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// What `if (value)` decides.
    pub fn is_truthy(&self) -> bool {
        match self {
            Self::Null => false,
            Self::Bool(b) => *b,
            Self::Number(n) => *n != 0.0 && !n.is_nan(),
            Self::String(s) => !s.is_empty(),
            Self::Array(_) | Self::Object(_) => true,
        }
    }

    /// What `String(value)` and a template literal give.
    pub fn to_js_string(&self) -> JsString {
        match self {
            Self::Null => JsString::from("null"),
            Self::Bool(b) => JsString::from(if *b { "true" } else { "false" }),
            Self::Number(n) => JsString::from(number_to_string(*n)),
            Self::String(s) => s.clone(),
            Self::Array(items) => {
                let mut out = JsString::default();
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push_str(",");
                    }
                    if !matches!(item, Self::Null) {
                        out.push_js(&item.to_js_string());
                    }
                }
                out
            }
            Self::Object(_) => JsString::from("[object Object]"),
        }
    }
}

/// `String(value)` for a value that may be `undefined`.
pub fn to_js_string(value: Option<&JsValue>) -> JsString {
    value.map_or_else(|| JsString::from("undefined"), JsValue::to_js_string)
}

/// `Number(value)` for a value that may be `undefined`, which is what `<` and `>=` compare with.
pub fn to_number(value: Option<&JsValue>) -> f64 {
    match value {
        None | Some(JsValue::Object(_)) => f64::NAN,
        Some(JsValue::Null) => 0.0,
        Some(JsValue::Bool(b)) => f64::from(u8::from(*b)),
        Some(JsValue::Number(n)) => *n,
        Some(JsValue::String(s)) => string_to_number(&s.to_string_lossy()),
        // An array is its elements joined by commas first.
        Some(array @ JsValue::Array(_)) => string_to_number(&array.to_js_string().to_string_lossy()),
    }
}

/// The StringToNumber of the ECMAScript grammar: blank is 0, then a decimal, hex, octal or binary literal, else NaN.
fn string_to_number(text: &str) -> f64 {
    let text = trim_str(text);
    if text.is_empty() {
        return 0.0;
    }
    let radix = |digits: &str, radix: u32| match digits {
        "" => f64::NAN,
        _ if digits.chars().all(|c| c.is_digit(radix)) => {
            digits.chars().fold(0.0, |n, c| n * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0)))
        }
        _ => f64::NAN,
    };
    match text.get(..2).map(str::to_ascii_lowercase).as_deref() {
        Some("0x") => return radix(&text[2..], 16),
        Some("0o") => return radix(&text[2..], 8),
        Some("0b") => return radix(&text[2..], 2),
        _ => {}
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if unsigned == "Infinity" {
        return if text.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    // Rust's parser takes "inf", "nan" and "infinity" too, which JavaScript does not, so the shape is checked first.
    let (mantissa, exponent) = match unsigned.find(['e', 'E']) {
        Some(at) => (&unsigned[..at], Some(&unsigned[at + 1..])),
        None => (unsigned, None),
    };
    let digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let mantissa_ok = digits(whole) && digits(fraction) && !(whole.is_empty() && fraction.is_empty());
    let exponent_ok = exponent.is_none_or(|e| {
        let e = e.strip_prefix(['+', '-']).unwrap_or(e);
        !e.is_empty() && digits(e)
    });
    if mantissa_ok && exponent_ok { text.parse().unwrap_or(f64::NAN) } else { f64::NAN }
}

impl From<&str> for JsValue {
    fn from(text: &str) -> Self {
        Self::str(text)
    }
}

impl From<JsString> for JsValue {
    fn from(text: JsString) -> Self {
        Self::String(text)
    }
}

impl From<bool> for JsValue {
    fn from(b: bool) -> Self {
        Self::Bool(b)
    }
}

impl From<f64> for JsValue {
    fn from(n: f64) -> Self {
        Self::Number(n)
    }
}

/// `Number.prototype.toString`.
pub fn number_to_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_owned()
    } else if n == 0.0 {
        "0".to_owned()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".to_owned() } else { "-Infinity".to_owned() }
    } else {
        ryu_js::Buffer::new().format_finite(n).to_owned()
    }
}

/// Why a text is not JSON. `JSON.parse` would throw a `SyntaxError` on the same text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: &'static str,
    /// Byte offset into the text.
    pub at: usize,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at byte {}", self.message, self.at)
    }
}

impl std::error::Error for ParseError {}

/// Nesting beyond this is refused. V8 has no such limit, but no Omni payload comes near it, and the parser recurses.
const MAX_DEPTH: usize = 1000;

/// `JSON.parse(text)`.
pub fn parse(text: &str) -> Result<JsValue, ParseError> {
    let mut parser = Parser { text, bytes: text.as_bytes(), at: 0, depth: 0 };
    parser.skip_space();
    let value = parser.value()?;
    parser.skip_space();
    if parser.at < parser.bytes.len() {
        return Err(parser.error("unexpected text after the value"));
    }
    Ok(value)
}

/// A response body as `fetch`'s `res.json()` reads it: decoded as UTF-8 with U+FFFD for bad bytes, a leading byte
/// order mark dropped, then `JSON.parse`.
pub fn parse_bytes(bytes: &[u8]) -> Result<JsValue, ParseError> {
    let text = String::from_utf8_lossy(bytes);
    parse(text.strip_prefix('\u{feff}').unwrap_or(&text))
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    at: usize,
    depth: usize,
}

impl Parser<'_> {
    fn error(&self, message: &'static str) -> ParseError {
        ParseError { message, at: self.at }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn literal(&mut self, word: &str, value: JsValue) -> Result<JsValue, ParseError> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(value)
        } else {
            Err(self.error("unexpected token"))
        }
    }

    fn value(&mut self) -> Result<JsValue, ParseError> {
        match self.peek() {
            None => Err(self.error("unexpected end of text")),
            Some(b'{') => self.nested(Self::object),
            Some(b'[') => self.nested(Self::array),
            Some(b'"') => self.string().map(JsValue::String),
            Some(b't') => self.literal("true", JsValue::Bool(true)),
            Some(b'f') => self.literal("false", JsValue::Bool(false)),
            Some(b'n') => self.literal("null", JsValue::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => Err(self.error("unexpected token")),
        }
    }

    fn nested(&mut self, inner: fn(&mut Self) -> Result<JsValue, ParseError>) -> Result<JsValue, ParseError> {
        if self.depth >= MAX_DEPTH {
            return Err(self.error("nested too deep"));
        }
        self.depth += 1;
        let value = inner(self);
        self.depth -= 1;
        value
    }

    fn array(&mut self) -> Result<JsValue, ParseError> {
        self.at += 1;
        let mut items = Vec::new();
        self.skip_space();
        if self.peek() == Some(b']') {
            self.at += 1;
            return Ok(JsValue::Array(items));
        }
        loop {
            self.skip_space();
            items.push(self.value()?);
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b']') => {
                    self.at += 1;
                    return Ok(JsValue::Array(items));
                }
                _ => return Err(self.error("expected , or ] in an array")),
            }
        }
    }

    fn object(&mut self) -> Result<JsValue, ParseError> {
        self.at += 1;
        let mut listed = Vec::new();
        self.skip_space();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(JsValue::Object(JsObject::new()));
        }
        loop {
            self.skip_space();
            if self.peek() != Some(b'"') {
                return Err(self.error("expected a property name in quotes"));
            }
            let key = self.string()?;
            self.skip_space();
            if self.peek() != Some(b':') {
                return Err(self.error("expected : after a property name"));
            }
            self.at += 1;
            self.skip_space();
            let value = self.value()?;
            listed.push((key, value));
            self.skip_space();
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    return Ok(JsValue::Object(JsObject::from_listed(listed)));
                }
                _ => return Err(self.error("expected , or } in an object")),
            }
        }
    }

    fn string(&mut self) -> Result<JsString, ParseError> {
        self.at += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            // The run up to the next quote, backslash or control character is copied whole. Those bytes never occur
            // inside a multi-byte UTF-8 sequence, so the run ends on a character boundary.
            let start = self.at;
            while let Some(b) = self.peek() {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.at += 1;
            }
            units.extend(self.text[start..self.at].encode_utf16());
            match self.peek() {
                None => return Err(self.error("unterminated string")),
                Some(b'"') => {
                    self.at += 1;
                    return Ok(JsString(units));
                }
                Some(b'\\') => {
                    self.at += 1;
                    let unit = match self.peek() {
                        Some(b'"') => u16::from(b'"'),
                        Some(b'\\') => u16::from(b'\\'),
                        Some(b'/') => u16::from(b'/'),
                        Some(b'b') => 0x08,
                        Some(b'f') => 0x0C,
                        Some(b'n') => 0x0A,
                        Some(b'r') => 0x0D,
                        Some(b't') => 0x09,
                        Some(b'u') => {
                            let hex = self.bytes.get(self.at + 1..self.at + 5).ok_or_else(|| self.error("bad \\u escape"))?;
                            let mut unit: u16 = 0;
                            for &h in hex {
                                let digit = (h as char).to_digit(16).ok_or_else(|| self.error("bad \\u escape"))?;
                                unit = (unit << 4) | digit as u16;
                            }
                            self.at += 4;
                            unit
                        }
                        _ => return Err(self.error("bad escape in a string")),
                    };
                    self.at += 1;
                    units.push(unit);
                }
                Some(_) => return Err(self.error("control character in a string")),
            }
        }
    }

    fn number(&mut self) -> Result<JsValue, ParseError> {
        let start = self.at;
        if self.peek() == Some(b'-') {
            self.at += 1;
        }
        match self.peek() {
            Some(b'0') => self.at += 1,
            Some(b'1'..=b'9') => self.digits(),
            _ => return Err(self.error("bad number")),
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("bad number"));
            }
            self.digits();
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("bad number"));
            }
            self.digits();
        }
        // Rust rounds to the nearest double and answers infinity past the range, as JavaScript does.
        let n: f64 = self.text[start..self.at].parse().map_err(|_| self.error("bad number"))?;
        Ok(JsValue::Number(n))
    }

    fn digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
    }
}

/// `JSON.stringify(value)`.
pub fn stringify(value: &JsValue) -> String {
    let mut out = String::new();
    write_value(&mut out, value, None, 0);
    out
}

/// `JSON.stringify(value, null, 2)`.
pub fn stringify_pretty(value: &JsValue) -> String {
    let mut out = String::new();
    write_value(&mut out, value, Some(2), 0);
    out
}

fn newline(out: &mut String, indent: Option<usize>, level: usize) {
    if let Some(width) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', width * level));
    }
}

fn write_value(out: &mut String, value: &JsValue, indent: Option<usize>, level: usize) {
    match value {
        JsValue::Null => out.push_str("null"),
        JsValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        JsValue::Number(n) => {
            if n.is_finite() {
                out.push_str(&number_to_string(*n));
            } else {
                out.push_str("null");
            }
        }
        JsValue::String(s) => write_string(out, s),
        JsValue::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, level + 1);
                write_value(out, item, indent, level + 1);
            }
            newline(out, indent, level);
            out.push(']');
        }
        JsValue::Object(object) => {
            if object.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (i, (key, item)) in object.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                newline(out, indent, level + 1);
                write_string(out, key);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(out, item, indent, level + 1);
            }
            newline(out, indent, level);
            out.push('}');
        }
    }
}

/// QuoteJSONString: the short escapes, `\u00xx` for other control characters and `\udxxx` for a lone surrogate.
fn write_string(out: &mut String, text: &JsString) {
    out.push('"');
    for decoded in char::decode_utf16(text.units().iter().copied()) {
        match decoded {
            Ok('"') => out.push_str("\\\""),
            Ok('\\') => out.push_str("\\\\"),
            Ok('\u{08}') => out.push_str("\\b"),
            Ok('\u{0C}') => out.push_str("\\f"),
            Ok('\n') => out.push_str("\\n"),
            Ok('\r') => out.push_str("\\r"),
            Ok('\t') => out.push_str("\\t"),
            Ok(c) if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            Ok(c) => out.push(c),
            Err(lone) => out.push_str(&format!("\\u{:04x}", lone.unpaired_surrogate())),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round(text: &str) -> String {
        stringify(&parse(text).expect(text))
    }

    #[test]
    fn numbers_print_as_javascript_prints_them() {
        assert_eq!(
            round("[1.0, -0, 1e21, 1E5, 0.1, 123456789012345680000, 1e-7, 5e-324, 1e999, -1e999]"),
            "[1,0,1e+21,100000,0.1,123456789012345680000,1e-7,5e-324,null,null]"
        );
    }

    #[test]
    fn a_lone_surrogate_survives_a_round_trip() {
        // An emoji cut in half, as the server's history page leaves it at its character limit.
        let value = parse(r#"{"text":"cut \ud83d"}"#).unwrap();
        let text = value.get("text").unwrap().as_js_string().unwrap();
        assert_eq!(text.len(), 5);
        assert_eq!(stringify(&value), r#"{"text":"cut \ud83d"}"#);
        assert_eq!(text.to_string_lossy(), "cut \u{fffd}");
        // A whole pair prints as the character.
        assert_eq!(round(r#""\ud83d\ude00""#), "\"\u{1f600}\"");
    }

    #[test]
    fn integer_keys_come_first_in_numeric_order() {
        assert_eq!(round(r#"{"b":1,"10":2,"2":3,"a":4,"01":5,"4294967295":6}"#), r#"{"2":3,"10":2,"b":1,"a":4,"01":5,"4294967295":6}"#);
    }

    #[test]
    fn a_repeated_key_keeps_its_place_and_its_last_value() {
        assert_eq!(round(r#"{"a":1,"b":2,"a":3}"#), r#"{"a":3,"b":2}"#);
    }

    #[test]
    fn pretty_printing_matches_two_space_indent() {
        let value = parse(r#"{"a":[1,{"b":[]},{}],"c":"x"}"#).unwrap();
        assert_eq!(stringify_pretty(&value), "{\n  \"a\": [\n    1,\n    {\n      \"b\": []\n    },\n    {}\n  ],\n  \"c\": \"x\"\n}");
    }

    #[test]
    fn strings_escape_as_json_stringify_does() {
        assert_eq!(
            round(r#""a\"b\\c\/d\b\f\n\r\t\u0001\u001f\u007f\u2028é""#),
            "\"a\\\"b\\\\c/d\\b\\f\\n\\r\\t\\u0001\\u001f\u{7f}\u{2028}é\""
        );
    }

    #[test]
    fn what_json_parse_refuses_is_refused() {
        for bad in [
            "",
            "{",
            "[1,]",
            "{\"a\":1,}",
            "01",
            "1.",
            ".5",
            "+1",
            "1e",
            "'a'",
            "\"a\nb\"",
            "\"\\x41\"",
            "\"\\u12\"",
            "nul",
            "[1] 2",
            "\u{feff}1",
            "{a:1}",
            "NaN",
            "-",
        ] {
            assert!(parse(bad).is_err(), "{bad:?} should not parse");
        }
        assert!(parse(&"[".repeat(MAX_DEPTH + 1)).is_err());
    }

    #[test]
    fn a_response_body_drops_its_byte_order_mark() {
        assert_eq!(parse_bytes(b"\xef\xbb\xbf{\"a\":1}").unwrap(), JsValue::object([("a", JsValue::Number(1.0))]));
        // A bad byte becomes U+FFFD instead of failing the body.
        assert_eq!(stringify(&parse_bytes(b"\"a\xffb\"").unwrap()), "\"a\u{fffd}b\"");
    }

    #[test]
    fn trim_removes_what_javascript_calls_space() {
        let s = JsString::from("\u{feff}\u{a0}\t x \u{2028}\u{3000}\n");
        assert_eq!(s.trim().to_string_lossy(), "x");
        // U+0085 is space to Rust and not to JavaScript.
        assert_eq!(JsString::from("\u{85}x").trim().len(), 2);
        assert!(JsString::from(" \n ").trim().is_empty());
    }

    #[test]
    fn truthiness_and_string_conversion() {
        assert!(!JsValue::str("").is_truthy());
        assert!(!JsValue::Number(f64::NAN).is_truthy());
        assert!(JsValue::Array(vec![]).is_truthy());
        assert_eq!(to_js_string(None).to_string_lossy(), "undefined");
        assert_eq!(parse(r#"[1,null,[2,3],"a",{}]"#).unwrap().to_js_string().to_string_lossy(), "1,,2,3,a,[object Object]");
        assert_eq!(JsValue::Number(1e21).to_js_string().to_string_lossy(), "1e+21");
    }

    #[test]
    fn objects_compare_without_regard_to_order() {
        assert_eq!(parse(r#"{"a":1,"b":[2]}"#).unwrap(), parse(r#"{"b":[2],"a":1}"#).unwrap());
        assert_ne!(parse(r#"{"a":1}"#).unwrap(), parse(r#"{"a":1,"b":2}"#).unwrap());
    }
}
