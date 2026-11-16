//! Holds the command's own formatting to what the TypeScript command made of the same inputs
//! (`packages/test-fixtures/native/cli-corpus.json`, recorded and re-checked by
//! `apps/cli/tests/native-corpus.test.ts`): times in several time zones, numbers, sizes, tables, thread arguments
//! and server addresses. `tests/goldens.rs` runs the whole command; this covers what depends on the clock, the time
//! zone or JavaScript's rounding.

use std::path::Path;

use chrono::Utc;
use chrono_tz::Tz;
use omni_core::js::{self, JsValue};

use crate::commands::open::app_launch;
use crate::connection::parse_base_url;
use crate::disk::{DiskLevel, disk_level, free_size};
use crate::num::{num, round, to_fixed};
use crate::proof::proof_for;
use crate::resolve::{id_from_link, looks_like_thread};
use crate::text::{clip, fields, table};
use crate::time::{elapsed_short, parse_date, rel_time};

/// One section of the corpus, and what differs from it.
struct Section {
    name: &'static str,
    cases: Vec<JsValue>,
    wrong: Vec<String>,
}

impl Section {
    fn load(name: &'static str, at_least: usize) -> Self {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/test-fixtures/native/cli-corpus.json");
        let corpus =
            js::parse(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).expect("the corpus is JSON");
        let cases = corpus.get(name).and_then(JsValue::as_array).unwrap_or_else(|| panic!("the corpus has no {name}")).to_vec();
        assert!(cases.len() >= at_least, "{name} went missing: {} cases", cases.len());
        Self { name, cases, wrong: Vec::new() }
    }

    /// Runs `answer` on every case: it gets the case and says what this command makes of it and what Node recorded.
    fn check(mut self, answer: impl Fn(&[JsValue]) -> (String, String)) {
        for case in &self.cases {
            let (got, want) = answer(case.as_array().expect("a case is a list"));
            if got != want {
                self.wrong.push(format!("{}: got {got:?}, Node has {want:?}", js::stringify(case)));
            }
        }
        assert!(
            self.wrong.is_empty(),
            "{}: {} of {} differ from Node:\n{}",
            self.name,
            self.wrong.len(),
            self.cases.len(),
            self.wrong.join("\n")
        );
    }
}

/// A recorded text as it prints: half of a surrogate pair is U+FFFD, as Node writes it to a terminal.
fn text(value: &JsValue) -> String {
    value.as_js_string().map(js::JsString::to_string_lossy).unwrap_or_else(|| panic!("{} is not a text", js::stringify(value)))
}

fn number(value: &JsValue) -> f64 {
    value.as_f64().unwrap_or_else(|| panic!("{} is not a number", js::stringify(value)))
}

fn zone(value: &JsValue) -> Tz {
    text(value).parse().expect("a time zone chrono-tz knows")
}

fn rows(value: &JsValue) -> Vec<Vec<String>> {
    value.as_array().expect("rows").iter().map(|row| row.as_array().expect("a row").iter().map(text).collect()).collect()
}

#[test]
fn says_how_long_ago_in_every_zone() {
    Section::load("relTime", 2000).check(|case| {
        let now = parse_date(&text(&case[1]), &Utc).expect("now is a date");
        (rel_time(&text(&case[2]), now, &zone(&case[0])), text(&case[3]))
    });
}

#[test]
fn reads_a_date_as_node_does() {
    Section::load("date", 270).check(|case| {
        let show = |ms: Option<f64>| ms.map_or_else(|| "null".to_string(), num);
        (show(parse_date(&text(&case[1]), &zone(&case[0]))), show(case[2].as_f64()))
    });
}

/// Where this command knowingly differs from Node (docs/internals/rust-port.md), so the corpus leaves these out.
#[test]
fn a_text_only_the_older_parser_of_v8_reads_is_no_date() {
    // Node reads each of these: the first three through the parser it keeps for texts that are not ISO 8601, the
    // last two as the edges of what a JavaScript date holds. The server sends none of them.
    for text in ["16 Nov 2026", "2026-1-6", "2026-11-16T10:30:00z", "+275760-09-13T00:00:00.000Z", "-271821-04-20T00:00:00Z"] {
        assert_eq!(parse_date(text, &Utc), None, "{text}");
    }
}

#[test]
fn rounds_as_javascript_does() {
    Section::load("toFixed", 120).check(|case| (to_fixed(number(&case[0]), number(&case[1]) as u32), text(&case[2])));
    Section::load("round", 20).check(|case| (num(round(number(&case[0]))), text(&case[1])));
}

#[test]
fn words_sizes_and_durations() {
    Section::load("freeSize", 20).check(|case| (free_size(number(&case[0])), text(&case[1])));
    Section::load("diskLevel", 15).check(|case| {
        let level = match disk_level(number(&case[0]), number(&case[1])) {
            DiskLevel::Ok => "ok",
            DiskLevel::Low => "low",
            DiskLevel::Critical => "critical",
        };
        (level.to_string(), text(&case[2]))
    });
    Section::load("elapsedShort", 15).check(|case| (elapsed_short(number(&case[0])), text(&case[1])));
}

#[test]
fn cuts_and_lines_up_text() {
    Section::load("clip", 20).check(|case| (clip(&text(&case[0]), number(&case[1]) as usize), text(&case[2])));
    Section::load("table", 7).check(|case| (table(&rows(&case[0])), text(&case[1])));
    Section::load("fields", 5).check(|case| {
        let rows: Vec<(String, Option<String>)> = case[0]
            .as_array()
            .expect("rows")
            .iter()
            .map(|row| {
                (
                    text(&row.as_array().expect("a row")[0]),
                    row.as_array().expect("a row")[1].as_js_string().map(js::JsString::to_string_lossy),
                )
            })
            .collect();
        let rows: Vec<(&str, Option<String>)> = rows.iter().map(|(key, value)| (key.as_str(), value.clone())).collect();
        (fields(&rows), text(&case[1]))
    });
}

#[test]
fn reads_a_thread_argument() {
    // `false` where JavaScript throws: here that is an error, with a line of its own in place of a stack.
    Section::load("thread", 35).check(|case| {
        let id = match id_from_link(&text(&case[0])) {
            Ok(Some(id)) => js::stringify(&JsValue::str(&id)),
            Ok(None) => "null".to_string(),
            Err(_) => "false".to_string(),
        };
        let looks = looks_like_thread(&text(&case[0])).map_or_else(|_| "false".to_string(), |looks| looks.to_string());
        (format!("{id} {looks}"), format!("{} {}", js::stringify(&case[1]), js::stringify(&case[2])))
    });
}

#[test]
fn reads_a_server_address() {
    Section::load("address", 25).check(|case| {
        let got = parse_base_url(&text(&case[0]))
            .map_or_else(|| "null".to_string(), |base| format!("{} {} {}", base.url, base.port, !base.loopback));
        let want = if case[1] == JsValue::Null {
            "null".to_string()
        } else {
            format!("{} {} {}", text(&case[1]), num(number(&case[2])), js::stringify(&case[3]))
        };
        (got, want)
    });
}

#[test]
fn starts_the_app_and_signs_a_proof() {
    Section::load("launch", 6).check(|case| {
        let (bin, args) = app_launch(&text(&case[0]), case[1] == JsValue::Bool(true), &text(&case[2]));
        let want: Vec<String> = case[4].as_array().expect("arguments").iter().map(text).collect();
        (format!("{bin} {args:?}"), format!("{} {want:?}", text(&case[3])))
    });
    Section::load("proof", 3).check(|case| (proof_for(&text(&case[0]), number(&case[1]) as u16, &text(&case[2])), text(&case[3])));
}
