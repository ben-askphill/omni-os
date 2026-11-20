//! `omni new` and `omni send`: start a thread, message one, and with `--wait` report how its turn ended.

use omni_core::js::{self, JsValue};

use crate::api;
use crate::args::{self, Parsed, Spec, short_switch, short_value, switch};
use crate::commands::open::open_route;
use crate::connection::Client;
use crate::error::{Error, Result, exit};
use crate::format::{blocker_text, short_id};
use crate::resolve::resolve_thread;
use crate::sys;
use crate::text::{clip, without_final_newlines};
use crate::val::{json, object, or_null, shown, string, text, truthy_text};
use crate::wait::{Kind, Outcome, Seen, newest_event, status_busy, wait_for};

/// The text from the arguments, or stdin when there is none or it is "-".
fn text_from(words: &[String], what: &str) -> Result<String> {
    let piped = words.is_empty() || (words.len() == 1 && words[0] == "-");
    let text = if piped { sys::stdin().unwrap_or_default() } else { words.join(" ") };
    if js::trim_str(&text).is_empty() {
        return Err(Error::usage(format!("write a {what}, or pipe one in")));
    }
    Ok(if piped { without_final_newlines(&text).to_string() } else { text })
}

fn thread_link(c: &Client, id: &str) -> String {
    c.link(&format!("#/t/{id}"))
}

fn end_line(o: &Outcome) -> String {
    let id = short_id(&text(&o.thread, "id"));
    if o.kind == Kind::NeedsYou {
        let why = o.blockers.iter().map(blocker_text).collect::<Vec<_>>().join("; ");
        return format!("{id} needs you: {}", if why.is_empty() { "see the thread" } else { &why });
    }
    match o.error.as_deref().filter(|e| !e.is_empty()) {
        Some(error) => format!("{id} {}: {}", o.kind.name(), clip(error, 300)),
        None => format!("{id} {}", o.kind.name()),
    }
}

fn outcome_json(c: &Client, o: &Outcome) -> JsValue {
    object(vec![
        ("id", o.thread.get("id").cloned()),
        ("outcome", string(o.kind.name())),
        ("status", o.thread.get("status").cloned()),
        ("reply", string(&o.reply)),
        ("needs_you", Some(JsValue::Array(o.blockers.clone()))),
        ("error", or_null(o.error.as_deref().map(JsValue::str))),
        ("url", string(&thread_link(c, &shown(&o.thread, "id")))),
        ("thread", Some(o.thread.clone())),
    ])
}

/// Waits, prints the reply on stdout and how it ended on stderr (or one JSON object), and answers the exit code.
fn wait_and_report(c: &Client, id: &str, mut seen: Seen, as_json: bool) -> Result<i32> {
    if !as_json {
        sys::err(&format!("Waiting for {}. Ctrl-C stops waiting, not the thread.\n", short_id(id)));
    }
    let outcome = wait_for(c, id, &mut seen)?;
    if as_json {
        sys::out(&json(&outcome_json(c, &outcome)));
    } else {
        if !outcome.reply.is_empty() {
            sys::out(&format!("{}\n", without_final_newlines(&outcome.reply)));
        }
        sys::err(&format!("{}\n{}\n", end_line(&outcome), thread_link(c, id)));
    }
    Ok(outcome.kind.exit())
}

const NEW_FLAGS: &[Spec] = &[
    short_value("channel", "c"),
    short_value("agent", "a"),
    // The old name, still accepted.
    short_value("role", "r"),
    short_value("model", "m"),
    short_switch("wait", "w"),
    switch("json"),
    short_switch("open", "o"),
];

pub fn new_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, NEW_FLAGS)?;
    let prompt = text_from(&p.positional, "prompt")?;
    let c = Client::from_env()?;
    let parent = c.conn.thread.clone();
    let body = object(vec![
        // A retry after a lost answer gets this thread back instead of a second one.
        ("id", string(&sys::uuid())),
        ("prompt", string(&prompt)),
        ("channel", p.value("channel").map(JsValue::str)),
        ("role", p.value("agent").or_else(|| p.value("role")).map(JsValue::str)),
        ("model", p.value("model").map(JsValue::str)),
        // From inside a thread it is a delegation, as the Conductor's delegate makes: filed under it, reporting back.
        ("source", string(if parent.is_some() { "conductor" } else { "capture" })),
        ("parent_id", parent.as_deref().map(JsValue::str)),
    ]);
    let t = c.post(api::THREADS, &body)?;
    let id = shown(&t, "id");
    let started = format!("Started {} in #{}: {}\n", short_id(&id), shown(&t, "channel_id"), shown(&t, "title"));
    if p.flag("open") {
        open_route(&c, &format!("#/t/{id}"), p.flag("json") || p.flag("wait"))?;
    }
    if p.flag("wait") {
        if !p.flag("json") {
            sys::err(&started);
        }
        return wait_and_report(&c, &id, Seen { baseline: 0.0, saw_busy: status_busy(&t) }, p.flag("json"));
    }
    if p.flag("json") {
        sys::out(&json(&object(vec![("id", t.get("id").cloned()), ("url", string(&thread_link(&c, &id))), ("thread", Some(t.clone()))])));
    } else {
        sys::out(&format!("{started}{}\n", thread_link(&c, &id)));
    }
    Ok(exit::OK)
}

const SEND_FLAGS: &[Spec] = &[switch("queue"), switch("interrupt"), short_switch("wait", "w"), switch("json")];

fn mode_of(p: &Parsed) -> Result<&'static str> {
    if p.flag("queue") && p.flag("interrupt") {
        return Err(Error::usage("pick --queue or --interrupt, not both"));
    }
    Ok(if p.flag("queue") {
        "queue"
    } else if p.flag("interrupt") {
        "interrupt"
    } else {
        "steer"
    })
}

fn how(mode: &str) -> &'static str {
    match mode {
        "queue" => "it runs after the current turn",
        "interrupt" => "the current turn stops and it runs",
        _ => "it reads it at its next step",
    }
}

pub fn send_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, SEND_FLAGS)?;
    let Some(target) = p.word(0).filter(|t| !t.is_empty()) else {
        return Err(Error::usage("say which thread to send to"));
    };
    let mode = mode_of(&p)?;
    let message = text_from(&p.positional[1..], "message")?;
    let c = Client::from_env()?;
    let id = resolve_thread(&c, target)?;
    // The newest event before sending, so the wait ends on the turn this message starts, not an older one.
    let baseline = if p.flag("wait") { newest_event(&c.get(&api::thread(&id))?) } else { 0.0 };
    let body = object(vec![
        ("prompt", string(&message)),
        ("mode", string(mode)),
        ("request_id", string(&sys::uuid())),
        // An agent's message reads as the Conductor's, as message_thread sends it; a person's as Ben's.
        ("from", string(if c.conn.thread.is_some() { "conductor" } else { "ben" })),
    ]);
    let sent = c.post(&api::messages(&id), &body)?;
    let forwarded_to = truthy_text(&sent, "forwarded_to");
    let place = forwarded_to.as_deref().map(|to| format!(" on {to}")).unwrap_or_default();
    if p.flag("wait") {
        if !p.flag("json") {
            sys::err(&format!("Sent to {}{place}.\n", short_id(&id)));
        }
        return wait_and_report(&c, &id, Seen { baseline, saw_busy: status_busy(&sent) }, p.flag("json"));
    }
    if p.flag("json") {
        sys::out(&json(&object(vec![
            ("id", string(&id)),
            ("status", sent.get("status").cloned()),
            ("request", sent.get("request").cloned()),
            ("forwarded_to", sent.get("forwarded_to").filter(|f| f.is_truthy()).cloned()),
            ("url", string(&thread_link(&c, &id))),
        ])));
    } else {
        let busy = status_busy(&sent) && mode != "interrupt";
        let then = if busy { format!(": {}", how(mode)) } else { String::new() };
        sys::out(&format!("Sent to {}{place} ({}){then}.\n", short_id(&id), shown(&sent, "status")));
    }
    Ok(exit::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(kind: Kind, blockers: &str, error: Option<&str>) -> Outcome {
        Outcome {
            kind,
            thread: js::parse(r#"{"id":"11111111-2222-4333-8444-555555555555","status":"done"}"#).unwrap(),
            reply: String::new(),
            blockers: js::parse(blockers).unwrap().as_array().unwrap().to_vec(),
            error: error.map(str::to_string),
        }
    }

    #[test]
    fn says_how_a_wait_ended() {
        assert_eq!(end_line(&outcome(Kind::Done, "[]", None)), "11111111 done");
        assert_eq!(end_line(&outcome(Kind::Failed, "[]", Some("the harness\n exited"))), "11111111 failed: the harness exited");
        assert_eq!(end_line(&outcome(Kind::Stopped, "[]", Some(""))), "11111111 stopped");
        assert_eq!(end_line(&outcome(Kind::NeedsYou, "[]", None)), "11111111 needs you: see the thread");
        assert_eq!(
            end_line(&outcome(
                Kind::NeedsYou,
                r#"[{"kind":"question","count":2,"detail":"Which one?"},{"kind":"limited","count":1}]"#,
                None
            )),
            "11111111 needs you: question (2): Which one?; usage limit"
        );
    }

    #[test]
    fn a_message_takes_one_mode() {
        let parse = |args: &[&str]| args::parse(&args.iter().map(|a| (*a).to_string()).collect::<Vec<_>>(), SEND_FLAGS).unwrap();
        assert_eq!(mode_of(&parse(&[])).unwrap(), "steer");
        assert_eq!(mode_of(&parse(&["--queue"])).unwrap(), "queue");
        assert_eq!(mode_of(&parse(&["--interrupt"])).unwrap(), "interrupt");
        assert!(mode_of(&parse(&["--queue", "--interrupt"])).is_err());
    }
}
