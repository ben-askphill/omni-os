//! `--wait`: poll a thread until its turn is over, then say how it ended. Exit 0 done, 1 failed or stopped, 2 needs
//! you.

use omni_core::js::{self, JsValue};

use crate::api;
use crate::connection::Client;
use crate::error::{Result, exit};
use crate::format::{last_error, last_reply, needs_you_item};
use crate::sys;
use crate::val::{field, is, list};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Done,
    Failed,
    Stopped,
    NeedsYou,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
            Self::NeedsYou => "needs-you",
        }
    }

    pub fn exit(self) -> i32 {
        match self {
            Self::Done => exit::OK,
            Self::Failed | Self::Stopped => exit::FAILED,
            Self::NeedsYou => exit::NEEDS_YOU,
        }
    }
}

pub struct Outcome {
    pub kind: Kind,
    pub thread: JsValue,
    pub reply: String,
    pub blockers: Vec<JsValue>,
    /// Why it failed, when it did.
    pub error: Option<String>,
}

/// What the waiter knew when it started: the newest event id then, and whether it has seen the thread busy.
pub struct Seen {
    pub baseline: f64,
    pub saw_busy: bool,
}

/// Blockers that hold the thread until Ben acts, even while its turn still runs (a question waits inside the turn).
const HOLDING: [&str; 5] = ["question", "setup", "limited", "recovered", "uncertain"];

/// A handoff still on its way. The view stays on the thread a while after it lands, is declined or expires.
const IN_FLIGHT: [&str; 3] = ["requested", "preparing", "offered"];

fn one_of(value: &JsValue, key: &str, names: &[&str]) -> bool {
    names.iter().any(|name| is(value, key, name))
}

/// A thread whose status says a turn runs or waits for a slot.
pub fn status_busy(thread: &JsValue) -> bool {
    one_of(thread, "status", &["queued", "running"])
}

/// Still going: a turn runs or waits for a slot, its worktree is being made, a message is about to start the next
/// turn, or it is on its way to the machine that will run it (a thread sent elsewhere reads `stopped` here until then).
pub fn busy(d: &JsValue) -> bool {
    let thread = d.get("thread").unwrap_or(&JsValue::Null);
    if status_busy(thread) || is(thread, "setup", "preparing") {
        return true;
    }
    if list(d, "pending").iter().any(|p| one_of(p, "state", &["waiting", "sent"])) {
        return true;
    }
    d.get("handoff").filter(|h| h.is_truthy()).and_then(|h| h.get("state")).is_some_and(|state| one_of(state, "phase", &IN_FLIGHT))
}

fn event_id(event: &JsValue) -> f64 {
    js::to_number(event.get("id"))
}

/// How the wait ends with this reading, or `None` to keep waiting.
pub fn settle(d: &JsValue, item: Option<&JsValue>, seen: &Seen) -> Option<Kind> {
    let blockers = item.map(|i| list(i, "blockers")).unwrap_or_default();
    if blockers.iter().any(|b| one_of(b, "kind", &HOLDING)) {
        return Some(Kind::NeedsYou);
    }
    if busy(d) {
        return None;
    }
    let thread = d.get("thread").unwrap_or(&JsValue::Null);
    // The turn this wait is for has ended: it was seen running, or a result newer than the start is in, or it failed
    // before it could run. Without one of those a thread sent to another machine is not done, only not here yet.
    let ended = seen.saw_busy
        || is(thread, "status", "failed")
        || list(d, "events").iter().any(|e| is(e, "kind", "result") && event_id(e) > seen.baseline);
    if !ended {
        return None;
    }
    if !blockers.is_empty() {
        return Some(Kind::NeedsYou);
    }
    Some(if is(thread, "status", "done") {
        Kind::Done
    } else if is(thread, "status", "failed") {
        Kind::Failed
    } else {
        Kind::Stopped
    })
}

/// The newest event's id, or 0. As `Math.max`, an id that is no number makes the answer no number.
pub fn newest_event(d: &JsValue) -> f64 {
    list(d, "events").iter().map(event_id).fold(0.0, |max, id| if max.is_nan() || id.is_nan() { f64::NAN } else { max.max(id) })
}

/// A server that restarts mid-wait (an update) answers again within this many tries.
const UNREACHABLE_TRIES: u32 = 60;

pub fn wait_for(c: &Client, id: &str, seen: &mut Seen) -> Result<Outcome> {
    let paths = [api::thread(id), api::needs_you("thread", id)];
    let mut unreachable = 0;
    let mut tick: u32 = 0;
    loop {
        // After a sleep the server may be another one: it proves itself again before the poll gets the token.
        if tick > 0 {
            c.forget();
        }
        let mut answers = c.get_all(&[&paths[0], &paths[1]]).into_iter();
        let read = match (answers.next(), answers.next()) {
            (Some(Ok(d)), Some(Ok(needs))) => Ok((d, needs)),
            (Some(Err(e)), _) | (_, Some(Err(e))) => Err(e),
            _ => unreachable!("two paths give two answers"),
        };
        let (d, needs) = match read {
            Ok(read) => {
                unreachable = 0;
                read
            }
            Err(e) => {
                unreachable += 1;
                if !e.is_unreachable() || unreachable >= UNREACHABLE_TRIES {
                    return Err(e);
                }
                sys::sleep(2000);
                tick = tick.saturating_add(1);
                continue;
            }
        };
        let item = needs_you_item(&needs, id);
        if busy(&d) {
            seen.saw_busy = true;
        }
        if let Some(kind) = settle(&d, item, seen) {
            let thread = d.get("thread").cloned().unwrap_or(JsValue::Null);
            let events = list(&d, "events");
            // A failed turn's preview is the turn before it: leave it out rather than pass it off as this one's reply.
            let fallback = if kind == Kind::Failed { None } else { field(&thread, "last_text") };
            let reply = last_reply(c, id, events, fallback)?;
            let blockers = item.map(|i| list(i, "blockers").to_vec()).unwrap_or_default();
            let error = if kind == Kind::Failed { last_error(events) } else { None };
            return Ok(Outcome { kind, thread, reply, blockers, error });
        }
        sys::sleep(if tick < 30 { 1000 } else { 3000 });
        tick = tick.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(json: &str) -> JsValue {
        js::parse(json).unwrap()
    }

    const FRESH: Seen = Seen { baseline: 0.0, saw_busy: false };
    const SAW: Seen = Seen { baseline: 0.0, saw_busy: true };

    #[test]
    fn a_running_or_handed_off_thread_is_busy() {
        assert!(busy(&reading(r#"{"thread":{"status":"running"}}"#)));
        assert!(busy(&reading(r#"{"thread":{"status":"queued"}}"#)));
        assert!(busy(&reading(r#"{"thread":{"status":"done","setup":"preparing"}}"#)));
        assert!(busy(&reading(r#"{"thread":{"status":"done"},"pending":[{"state":"held"},{"state":"sent"}]}"#)));
        assert!(busy(&reading(r#"{"thread":{"status":"stopped"},"handoff":{"state":{"phase":"offered"}}}"#)));
        assert!(!busy(&reading(r#"{"thread":{"status":"stopped"},"handoff":{"state":{"phase":"landed"}}}"#)));
        assert!(!busy(&reading(r#"{"thread":{"status":"done"},"pending":[{"state":"held"}],"handoff":null}"#)));
    }

    #[test]
    fn a_holding_blocker_ends_the_wait_even_while_the_turn_runs() {
        let d = reading(r#"{"thread":{"status":"running"},"events":[]}"#);
        let item = reading(r#"{"blockers":[{"kind":"question"}]}"#);
        assert_eq!(settle(&d, Some(&item), &FRESH), Some(Kind::NeedsYou));
        let child = reading(r#"{"blockers":[{"kind":"child_failed"}]}"#);
        assert_eq!(settle(&d, Some(&child), &FRESH), None);
    }

    #[test]
    fn the_wait_ends_only_on_the_turn_it_is_for() {
        let done = reading(r#"{"thread":{"status":"done"},"events":[{"id":4,"kind":"result"}]}"#);
        assert_eq!(settle(&done, None, &FRESH), Some(Kind::Done));
        assert_eq!(settle(&done, None, &Seen { baseline: 4.0, saw_busy: false }), None);
        assert_eq!(settle(&done, None, &Seen { baseline: 4.0, saw_busy: true }), Some(Kind::Done));
        let stopped = reading(r#"{"thread":{"status":"stopped"},"events":[]}"#);
        assert_eq!(settle(&stopped, None, &FRESH), None);
        assert_eq!(settle(&stopped, None, &SAW), Some(Kind::Stopped));
        let failed = reading(r#"{"thread":{"status":"failed"},"events":[]}"#);
        assert_eq!(settle(&failed, None, &FRESH), Some(Kind::Failed));
        let child = reading(r#"{"blockers":[{"kind":"child_failed"}]}"#);
        assert_eq!(settle(&done, Some(&child), &FRESH), Some(Kind::NeedsYou));
    }

    #[test]
    fn finds_the_newest_event() {
        assert_eq!(newest_event(&reading(r#"{"events":[{"id":3},{"id":9},{"id":5}]}"#)), 9.0);
        assert_eq!(newest_event(&reading(r#"{"events":[]}"#)), 0.0);
        assert!(newest_event(&reading(r#"{"events":[{"id":3},{}]}"#)).is_nan());
    }
}
