//! The API paths the command asks for, after `/api`, as client-core builds them: each value through
//! `encodeURIComponent`, the query in the order the TypeScript command names its keys.

use crate::connection::encode;
use crate::num::num;

pub const THREADS: &str = "/threads";
pub const STATUS: &str = "/status";
pub const SYNC_STATUS: &str = "/sync/status";
pub const UPDATE_FLEET: &str = "/update/fleet";
pub const MACHINES: &str = "/machines?stats=1";
pub const CHANNELS: &str = "/channels";
pub const NEEDS_YOU: &str = "/needs-you";

/// A thread with its recent history.
pub fn thread(id: &str) -> String {
    format!("/threads/{}?history=recent", encode(id))
}

/// The latest threads: of one channel, only the running ones, at most `limit`.
pub fn threads(channel: Option<&str>, running: bool, limit: f64) -> String {
    let mut query: Vec<String> = Vec::new();
    if let Some(channel) = channel {
        query.push(format!("channel={}", encode(channel)));
    }
    if running {
        query.push("status=running".to_string());
    }
    query.push(format!("limit={}", encode(&num(limit))));
    format!("/threads?{}", query.join("&"))
}

/// What waits on Ben in one thread or one channel: `key` is `thread` or `channel`.
pub fn needs_you(key: &str, value: &str) -> String {
    format!("/needs-you?{key}={}", encode(value))
}

/// One event in full, for a text the history cut short.
pub fn event(thread_id: &str, event_id: &str) -> String {
    format!("/threads/{}/events/{}", encode(thread_id), encode(event_id))
}

pub fn messages(thread_id: &str) -> String {
    format!("/threads/{}/messages", encode(thread_id))
}

pub fn channel(id: &str) -> String {
    format!("/channels/{}", encode(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_paths_as_client_core_does() {
        assert_eq!(thread("a b"), "/threads/a%20b?history=recent");
        assert_eq!(threads(None, false, 500.0), "/threads?limit=500");
        assert_eq!(threads(Some("my channel"), true, 20.0), "/threads?channel=my%20channel&status=running&limit=20");
        assert_eq!(needs_you("thread", "x/y"), "/needs-you?thread=x%2Fy");
        assert_eq!(event("t", "12"), "/threads/t/events/12");
        assert_eq!(messages("t"), "/threads/t/messages");
        assert_eq!(channel("ä"), "/channels/%C3%A4");
    }
}
