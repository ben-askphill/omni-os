//! `omni threads` and `omni show`: what is there, and one thread in detail (`apps/cli/src/commands/read.ts`).

use omni_core::js::{self, JsValue};

use crate::api;
use crate::args::{self, Spec, short_value, switch};
use crate::connection::Client;
use crate::error::{Error, Result, exit};
use crate::format::{blocker_text, last_error, last_reply, needs_you_item, needs_you_why, short_id, status_text, when};
use crate::resolve::resolve_thread;
use crate::sys;
use crate::text::{clip, fields, table, without_final_newlines};
use crate::time::{ran_on_title, run_elapsed};
use crate::val::{field, is, json, list, object, or_null, shown, string, text, truthy, truthy_text};

const THREADS_FLAGS: &[Spec] =
    &[switch("needs-you"), switch("running"), short_value("channel", "c"), short_value("limit", "n"), switch("json")];

/// The longest title a list shows.
const TITLE: usize = 70;

fn header(names: [&str; 5]) -> Vec<String> {
    names.iter().map(|n| (*n).to_string()).collect()
}

fn thread_row(t: &JsValue, now: f64) -> Vec<String> {
    vec![
        short_id(&text(t, "id")),
        status_text(t),
        format!("#{}", shown(t, "channel_id")),
        when(t.get("updated_at"), now),
        clip(&text(t, "title"), TITLE),
    ]
}

fn needs_row(item: &JsValue, now: f64) -> Vec<String> {
    let thread = item.get("thread").unwrap_or(&JsValue::Null);
    vec![
        short_id(&text(thread, "id")),
        needs_you_why(item),
        format!("#{}", shown(thread, "channel_id")),
        when(item.get("at"), now),
        clip(&text(thread, "title"), TITLE),
    ]
}

/// `--limit` as JavaScript's `Number` reads it: a whole number from 1 to 500.
fn limit_of(text: Option<&str>) -> Result<f64> {
    let limit = text.map_or(20.0, |t| js::to_number(Some(&JsValue::str(t))));
    if limit.fract() != 0.0 || !(1.0..=500.0).contains(&limit) {
        return Err(Error::usage("--limit takes a number from 1 to 500"));
    }
    Ok(limit)
}

pub fn threads_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, THREADS_FLAGS)?;
    if let Some(extra) = p.word(0) {
        return Err(Error::usage(format!("unexpected {extra}")));
    }
    let limit = limit_of(p.value("limit"))?;
    if p.flag("needs-you") && p.flag("running") {
        return Err(Error::usage("pick --needs-you or --running, not both"));
    }
    let c = Client::from_env()?;
    let channel = p.value("channel");
    let now = sys::now();

    if p.flag("needs-you") {
        let view = c.get(&channel.map_or_else(|| api::NEEDS_YOU.to_string(), |ch| api::needs_you("channel", ch)))?;
        let all = list(&view, "items");
        let items = &all[..all.len().min(limit as usize)];
        if p.flag("json") {
            sys::out(&json(&object(vec![
                ("unread", view.get("unread").cloned()),
                ("blocked", view.get("blocked").cloned()),
                ("items", Some(JsValue::Array(items.to_vec()))),
            ])));
        } else if items.is_empty() {
            sys::out("Nothing needs you.\n");
        } else {
            let mut rows = vec![header(["ID", "WHY", "CHANNEL", "WHEN", "TITLE"])];
            rows.extend(items.iter().map(|i| needs_row(i, now)));
            sys::out(&table(&rows));
        }
        return Ok(exit::OK);
    }

    let answer = c.get(&api::threads(channel, p.flag("running"), limit))?;
    let threads = answer.as_array().unwrap_or_default();
    if p.flag("json") {
        sys::out(&json(&answer));
    } else if threads.is_empty() {
        sys::out(if p.flag("running") { "Nothing is running.\n" } else { "No threads.\n" });
    } else {
        let mut rows = vec![header(["ID", "STATUS", "CHANNEL", "UPDATED", "TITLE"])];
        rows.extend(threads.iter().map(|t| thread_row(t, now)));
        sys::out(&table(&rows));
    }
    Ok(exit::OK)
}

pub fn show_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, &[switch("json")])?;
    let Some(target) = p.word(0).filter(|t| !t.is_empty()) else {
        return Err(Error::usage("say which thread to show"));
    };
    if let Some(extra) = p.word(1).filter(|e| !e.is_empty()) {
        return Err(Error::usage(format!("unexpected {extra}")));
    }
    let c = Client::from_env()?;
    let id = resolve_thread(&c, target)?;
    let mut answers = c.get_all(&[&api::thread(&id), &api::needs_you("thread", &id)]).into_iter();
    let d = answers.next().unwrap_or(Ok(JsValue::Null))?;
    let needs = answers.next().unwrap_or(Ok(JsValue::Null))?;
    let item = needs_you_item(&needs, &id);
    let t = d.get("thread").unwrap_or(&JsValue::Null);
    let events = list(&d, "events");
    let reply = last_reply(&c, &id, events, field(t, "last_text"))?;
    let url = c.link(&format!("#/t/{id}"));
    let error = if is(t, "status", "failed") { last_error(events) } else { None };
    let children = list(&d, "children");
    let pending = list(&d, "pending");
    let parent = field(&d, "parent");

    if p.flag("json") {
        let child = |t: &JsValue| {
            object(vec![("id", t.get("id").cloned()), ("status", t.get("status").cloned()), ("title", t.get("title").cloned())])
        };
        sys::out(&json(&object(vec![
            ("thread", d.get("thread").cloned()),
            ("error", or_null(error.as_deref().map(JsValue::str))),
            ("channel", field(&d, "channel").and_then(|ch| field(ch, "id")).or_else(|| t.get("channel_id")).cloned()),
            ("parent", or_null(parent.and_then(|p| field(p, "id")).cloned())),
            ("children", Some(JsValue::Array(children.iter().map(child).collect()))),
            ("pending", Some(JsValue::Number(pending.len() as f64))),
            ("needs_you", or_null(item.cloned())),
            ("reply", string(&reply)),
            ("url", string(&url)),
        ])));
        return Ok(exit::OK);
    }

    let now = sys::now();
    let zone = chrono::Local;
    let status = match run_elapsed(t, now, &zone).filter(|e| !e.is_empty()) {
        Some(elapsed) => format!("{} for {elapsed}", status_text(t)),
        None => format!("{}, updated {}", status_text(t), when(t.get("updated_at"), now)),
    };
    let run: Vec<String> = ["role", "harness", "model", "effort"].iter().filter_map(|key| truthy_text(t, key)).collect();
    let running = children.iter().filter(|ch| is(ch, "status", "running") || is(ch, "status", "queued")).count();
    let needs_you = item.map(|item| {
        let blockers = list(item, "blockers");
        if blockers.is_empty() { needs_you_why(item) } else { blockers.iter().map(blocker_text).collect::<Vec<_>>().join("; ") }
    });
    sys::out(&format!("{}\n", shown(t, "title")));
    sys::out(&fields(&[
        ("id", truthy_text(t, "id")),
        ("status", Some(status)),
        ("channel", Some(format!("#{}", shown(t, "channel_id")))),
        ("run", Some(run.join(" · "))),
        ("machine", truthy(t, "ran_on").then(|| ran_on_title(t, now, &zone))),
        ("branch", truthy_text(t, "branch")),
        ("parent", parent.filter(|p| p.is_truthy()).map(|p| format!("{} {}", short_id(&text(p, "id")), clip(&text(p, "title"), 60)))),
        (
            "children",
            (!children.is_empty())
                .then(|| if running > 0 { format!("{} ({running} running)", children.len()) } else { children.len().to_string() }),
        ),
        ("waiting", (!pending.is_empty()).then(|| format!("{} message{}", pending.len(), if pending.len() == 1 { "" } else { "s" }))),
        ("blocked", truthy_text(&d, "blocked")),
        ("error", error.as_deref().filter(|e| !e.is_empty()).map(|e| clip(e, 200))),
        ("setup", truthy_text(t, "setup_error")),
        ("needs you", needs_you),
        ("url", Some(url)),
    ]));
    if !reply.is_empty() {
        sys::out(&format!("\n{}\n", without_final_newlines(&reply)));
    }
    Ok(exit::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_limit_as_javascript_does() {
        assert_eq!(limit_of(None).unwrap(), 20.0);
        assert_eq!(limit_of(Some("1")).unwrap(), 1.0);
        assert_eq!(limit_of(Some(" 500 ")).unwrap(), 500.0);
        assert_eq!(limit_of(Some("0x10")).unwrap(), 16.0);
        assert_eq!(limit_of(Some("1e2")).unwrap(), 100.0);
        for bad in ["0", "501", "2.5", "ten", "-3", "Infinity"] {
            assert!(limit_of(Some(bad)).is_err(), "{bad}");
        }
    }
}
