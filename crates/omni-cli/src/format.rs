//! How the command prints threads and what waits on Ben: plain lines, nothing that needs a terminal, since agents
//! read this output too.

use omni_core::js::{self, JsValue};

use crate::api;
use crate::connection::Client;
use crate::error::Result;
use crate::num::num;
use crate::text::{clip, slice16};
use crate::time::rel_time;
use crate::val::{field, is, list, shown, text};

pub fn short_id(id: &str) -> String {
    slice16(id, 8)
}

/// How long ago a time field was, or empty when it is not set.
pub fn when(value: Option<&JsValue>, now: f64) -> String {
    match value.and_then(JsValue::as_js_string).filter(|s| !s.is_empty()) {
        Some(iso) => rel_time(&iso.to_string_lossy(), now, &chrono::Local),
        None => String::new(),
    }
}

fn blocker_label(blocker: &JsValue) -> String {
    let kind = text(blocker, "kind");
    match kind.as_str() {
        "question" => "question",
        "setup" => "setup failed",
        "recovered" => "messages to resume",
        "uncertain" => "message may not have arrived",
        "limited" => "usage limit",
        "child_failed" => "delegated thread failed",
        other => other,
    }
    .to_string()
}

pub fn blocker_text(blocker: &JsValue) -> String {
    let what = blocker_label(blocker);
    let count = match blocker.get("count").map(|c| js::to_number(Some(c))) {
        Some(n) if n > 1.0 => format!(" ({})", num(n)),
        _ => String::new(),
    };
    match blocker.get("detail").filter(|d| d.is_truthy()) {
        Some(detail) => format!("{what}{count}: {}", clip(&detail.to_js_string().to_string_lossy(), 120)),
        None => format!("{what}{count}"),
    }
}

/// Why a thread is in Needs you, in a few words.
pub fn needs_you_why(item: &JsValue) -> String {
    let blockers = list(item, "blockers");
    if !blockers.is_empty() {
        return blockers.iter().map(blocker_label).collect::<Vec<_>>().join(", ");
    }
    match item.get("result").filter(|r| r.is_truthy()) {
        Some(result) => format!("{}, unread", shown(result, "status")),
        None => String::new(),
    }
}

/// Running or waiting to run: the thread's status, its worktree being prepared, or a usage limit.
pub fn status_text(thread: &JsValue) -> String {
    if is(thread, "setup", "preparing") {
        return "preparing".to_string();
    }
    match thread.get("limit_state").filter(|l| l.is_truthy()) {
        Some(limit) if limit.as_js_string().is_some_and(|s| s.eq_str("scheduled")) => "limit, resumes later".to_string(),
        Some(_) => "usage limit".to_string(),
        None => text(thread, "status"),
    }
}

/// An event's payload is JSON in a string.
fn payload(event: &JsValue) -> Option<JsValue> {
    js::parse(&event.get("payload")?.as_js_string()?.to_string_lossy()).ok()
}

fn dropped(event: &JsValue) -> bool {
    matches!(payload(event).as_ref().and_then(|p| p.get("dropped")), Some(JsValue::Bool(true)))
        || payload(event).as_ref().and_then(|p| p.get("dropped")).and_then(JsValue::as_f64) == Some(1.0)
}

fn text_of(event: &JsValue) -> String {
    payload(event)
        .as_ref()
        .and_then(|p| p.get("text"))
        .and_then(JsValue::as_js_string)
        .map(js::JsString::to_string_lossy)
        .unwrap_or_default()
}

fn id_of(event: &JsValue) -> f64 {
    js::to_number(event.get("id"))
}

/// Text events between the last message the thread got and now: its latest reply, as the Conductor reads it.
pub fn last_reply(c: &Client, thread_id: &str, events: &[JsValue], fallback: Option<&JsValue>) -> Result<String> {
    let mut from = 0.0;
    for e in events {
        if (is(e, "kind", "user") || is(e, "kind", "crew_report")) && !dropped(e) {
            from = id_of(e);
        }
    }
    let mut texts: Vec<String> = Vec::new();
    for e in events {
        // `e.id <= from` is false for an id that is no number, so such an event counts.
        if !is(e, "kind", "assistant_text") || id_of(e) <= from {
            continue;
        }
        let text = if e.get("clipped").is_some_and(JsValue::is_truthy) {
            text_of(&c.get(&api::event(thread_id, &js::to_js_string(e.get("id")).to_string_lossy()))?)
        } else {
            text_of(e)
        };
        if !text.is_empty() {
            texts.push(text);
        }
    }
    if !texts.is_empty() {
        return Ok(texts.join("\n\n"));
    }
    Ok(fallback.filter(|f| !matches!(f, JsValue::Null)).map(|f| f.to_js_string().to_string_lossy()).unwrap_or_default())
}

/// Why the last turn failed: the newest error event's text (a harness that exited, a refused resume), or `None`.
pub fn last_error(events: &[JsValue]) -> Option<String> {
    let event = events.iter().rev().find(|e| is(e, "kind", "error"))?;
    Some(text_of(event)).filter(|t| !t.is_empty())
}

/// The thread a Needs you answer holds for `id`, if it holds one.
pub fn needs_you_item<'a>(needs: &'a JsValue, id: &str) -> Option<&'a JsValue> {
    list(needs, "items").iter().find(|item| field(item, "thread").is_some_and(|t| is(t, "id", id)))
}
