//! Holds the `js` module to what Node made of the same JSON texts (`packages/test-fixtures/native/js-corpus.json`,
//! recorded and re-checked by `apps/mcp/tests/js-corpus.test.ts`): what parses, how it prints back, and what
//! JavaScript's own conversions say of the value.

use std::path::Path;

use omni_core::js::{self, JsString, JsValue};

fn text(case: &JsValue, key: &str) -> Option<JsString> {
    case.get(key).and_then(JsValue::as_js_string).cloned()
}

#[test]
fn every_case_reads_and_prints_as_node_recorded() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/test-fixtures/native/js-corpus.json");
    let corpus =
        js::parse(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("the corpus is JSON");
    let cases = corpus.get("cases").and_then(JsValue::as_array).expect("a list of cases");
    assert!(cases.len() >= 200, "the corpus went missing: {} cases", cases.len());

    let mut wrong = Vec::new();
    let mut checked = 0;
    for case in cases {
        // A JSON text arrives as bytes, so it never holds a lone surrogate itself, only the escape for one.
        let source = text(case, "text").and_then(|t| t.to_text()).expect("a case is a text");
        let mut differ = |what: &str, got: String, want: Option<JsString>| {
            if want.as_ref().is_none_or(|want| !want.eq_str(&got)) {
                wrong.push(format!("{source:?}: {what} is {got:?}, Node has {:?}", want.map(|w| w.to_string_lossy())));
            }
        };
        checked += 1;
        let parsed = js::parse(&source);
        if case.get("ok") != Some(&JsValue::Bool(parsed.is_ok())) {
            differ("parses", parsed.is_ok().to_string(), None);
            continue;
        }
        let Ok(value) = parsed else { continue };
        differ("compact", js::stringify(&value), text(case, "compact"));
        differ("pretty", js::stringify_pretty(&value), text(case, "pretty"));
        differ("truthy", value.is_truthy().to_string(), case.get("truthy").map(JsValue::to_js_string));
        // Node recorded no conversion where JavaScript throws one, which `to_js_string` does not model.
        if let Some(string) = text(case, "string") {
            if value.to_js_string() != string {
                differ("String(value)", value.to_js_string().to_string_lossy(), Some(string));
            }
            differ("Number(value)", js::number_to_string(js::to_number(Some(&value))), text(case, "number"));
        }
        if let JsValue::String(string) = &value {
            if Some(string.trim()) != text(case, "trimmed") {
                differ("trim", string.trim().to_string_lossy(), text(case, "trimmed"));
            }
            differ("code points", string.code_points().to_string(), case.get("codePoints").map(JsValue::to_js_string));
            match (js::encode_uri_component(string), text(case, "uri")) {
                (None, None) => {}
                (got, want) => differ("encodeURIComponent", got.unwrap_or_else(|| "a URIError".to_owned()), want),
            }
        }
    }
    assert_eq!(checked, cases.len());
    assert!(wrong.is_empty(), "{} differences from Node:\n{}", wrong.len(), wrong.join("\n"));
}
