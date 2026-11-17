//! `omni status`: this Omni's version, running turns, Needs you, sync and update state. `--machine` reads another
//! synced machine as this Omni sees it (GET /machines and the update fleet), so it needs no route to that machine.

use omni_core::js::{self, JsValue};

use crate::api;
use crate::args::{self, switch, value};
use crate::connection::Client;
use crate::disk::free_size;
use crate::error::{Error, Result, exit};
use crate::format::when;
use crate::num::{num, round, to_fixed};
use crate::sys;
use crate::text::{clip, fields, slice16};
use crate::val::{field, is, json, list, number, object, or_null, shown, string, text, truthy, truthy_text};

/// Where a machine's update stands, from its row in the update fleet.
pub fn update_text(row: Option<&JsValue>) -> Option<String> {
    let row = row?;
    let s = field(row, "status").unwrap_or(&JsValue::Null);
    let running = truthy_text(s, "version").map(|v| format!(" (runs {v})")).unwrap_or_default();
    let next = field(s, "available").map_or_else(|| "an update".to_string(), |a| a.to_js_string().to_string_lossy());
    let state = shown(row, "state");
    Some(match state.as_str() {
        "up-to-date" => format!("up to date{running}"),
        "available" => format!("{next} available{running}"),
        "downloading" => match field(s, "progress") {
            Some(progress) => format!("downloading {next} ({}%)", num(round(js::to_number(Some(progress))))),
            None => format!("downloading {next}"),
        },
        "ready" => format!("{next} downloaded, applies on restart{running}"),
        "waiting" => {
            let waiting = field(s, "waitingFor").map_or_else(|| "0".to_string(), |w| w.to_js_string().to_string_lossy());
            format!("restarting for {next} once {waiting} running turn{} end", if number(s, "waitingFor") == Some(1.0) { "" } else { "s" })
        }
        "failed" => match truthy_text(s, "error") {
            Some(error) => format!("update failed: {}{running}", clip(&error, 100)),
            None => format!("update failed{running}"),
        },
        "offline" => "offline".to_string(),
        "sent" => "asked to update, not taken yet".to_string(),
        "expired" => "asked to update, never took it".to_string(),
        "not-reporting" => "runs an Omni from before Update all machines".to_string(),
        other => format!("{other}{running}"),
    })
}

/// Whether sync runs, and how far behind it is.
pub fn sync_text(s: Option<&JsValue>, now: f64) -> Option<String> {
    let s = s.filter(|s| s.is_truthy())?;
    Some(if !truthy(s, "configured") {
        "off".to_string()
    } else if truthy(s, "signedOut") {
        "signed out: sign in again in Settings > Sync".to_string()
    } else if !truthy(s, "enabled") {
        "paused".to_string()
    } else if let Some(error) = truthy_text(s, "lastError") {
        let failures = js::to_number(s.get("failures"));
        let row = if failures > 1.0 { format!(" ({} in a row)", shown(s, "failures")) } else { String::new() };
        format!("failing{row}: {}", clip(&error, 100))
    } else {
        let last =
            if truthy(s, "lastSyncAt") { format!("last synced {}", when(s.get("lastSyncAt"), now)) } else { "not synced yet".to_string() };
        let pending = if truthy(s, "pending") { format!(", {} to push", shown(s, "pending")) } else { String::new() };
        format!("on, {last}{pending}")
    })
}

/// "1 thread", "3 threads".
fn plural(of: &JsValue, key: &str, one: &str) -> String {
    format!("{} {one}{}", shown(of, key), if number(of, key) == Some(1.0) { "" } else { "s" })
}

pub fn status_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, &[value("machine"), switch("json")])?;
    if let Some(extra) = p.word(0) {
        return Err(Error::usage(format!("unexpected {extra}")));
    }
    match p.value("machine") {
        Some(machine) => machine_status(machine, p.flag("json")),
        None => own_status(p.flag("json")),
    }
}

/// The machine a fleet answer marks, by a test on its rows.
fn fleet_row(fleet: Option<&JsValue>, test: impl Fn(&JsValue) -> bool) -> Option<&JsValue> {
    list(fleet?, "machines").iter().find(|m| test(m))
}

fn own_status(as_json: bool) -> Result<i32> {
    let c = Client::from_env()?;
    // The one call that must answer: it says whether the server is there and takes the token.
    let status = c.get(api::STATUS)?;
    // The value, or nothing when the call failed: an older server lacks some of these routes.
    let mut rest = c
        .get_all(&[api::NEEDS_YOU, api::SYNC_STATUS, api::UPDATE_FLEET])
        .into_iter()
        .map(|r| r.ok().filter(|v| !matches!(v, JsValue::Null)));
    let needs = rest.next().flatten();
    let sync = rest.next().flatten();
    let fleet = rest.next().flatten();
    let update = fleet_row(fleet.as_ref(), |m| truthy(m, "current"));
    let now = sys::now();
    let device = field(&status, "device").and_then(|d| field(d, "name"));
    let server = field(&status, "server");
    let base_url = &c.conn.base_url;
    if as_json {
        sys::out(&json(&object(vec![
            ("url", string(base_url)),
            ("machine", or_null(device.cloned())),
            ("server", or_null(server.cloned())),
            ("running", or_null(field(&status, "running").cloned())),
            ("queued", or_null(field(&status, "queued").cloned())),
            (
                "needs_you",
                or_null(needs.as_ref().map(|n| object(vec![("unread", n.get("unread").cloned()), ("blocked", n.get("blocked").cloned())]))),
            ),
            ("sync", or_null(sync.clone())),
            ("update", or_null(update.cloned())),
        ])));
        return Ok(exit::OK);
    }
    let name: Vec<String> = std::iter::once("Omni".to_string()).chain(server.and_then(|s| truthy_text(s, "version"))).collect();
    let machine = device.map_or_else(|| "this machine".to_string(), |d| d.to_js_string().to_string_lossy());
    sys::out(&format!("{} on {machine} ({base_url})\n", name.join(" ")));
    let up = server.filter(|s| s.is_truthy()).map(|s| {
        let pid = truthy_text(s, "pid").map(|pid| format!(", pid {pid}")).unwrap_or_default();
        let commit = truthy_text(s, "gitHead").map(|head| format!(", commit {}", slice16(&head, 8))).unwrap_or_default();
        format!("up since {}{pid}{commit}", when(s.get("startedAt"), now))
    });
    let turns = status.get("running").map(|running| {
        let queued = field(&status, "queued").map_or_else(|| "0".to_string(), |q| q.to_js_string().to_string_lossy());
        format!("{} running, {queued} queued", running.to_js_string().to_string_lossy())
    });
    sys::out(&fields(&[
        ("server", up),
        ("turns", turns),
        (
            "needs you",
            needs
                .as_ref()
                .filter(|n| n.is_truthy())
                .map(|n| format!("{}, {}", plural(n, "unread", "unread result"), plural(n, "blocked", "blocked thread"))),
        ),
        ("sync", sync_text(sync.as_ref(), now)),
        ("update", update_text(update)),
    ]));
    Ok(exit::OK)
}

fn lower(value: &JsValue, key: &str) -> Option<String> {
    field(value, key).map(|v| v.to_js_string().to_string_lossy().to_lowercase())
}

/// A machine by its sync id, its name (any case) or "here".
pub fn find_machine<'a>(machines: &'a [JsValue], query: &str) -> Option<&'a JsValue> {
    let q = js::trim_str(query).to_lowercase();
    if q == "here" {
        return machines.iter().find(|m| truthy(m, "here"));
    }
    machines
        .iter()
        .find(|m| lower(m, "id").as_deref() == Some(&q))
        .or_else(|| machines.iter().find(|m| lower(m, "name").as_deref() == Some(&q)))
}

fn machine_status(query: &str, as_json: bool) -> Result<i32> {
    let c = Client::from_env()?;
    let mut answers = c.get_all(&[api::MACHINES, api::UPDATE_FLEET]).into_iter();
    let view = answers.next().unwrap_or(Ok(JsValue::Null))?;
    let fleet = answers.next().and_then(|r| r.ok()).filter(|v| !matches!(v, JsValue::Null));
    let machines = list(&view, "machines");
    let Some(m) = find_machine(machines, query) else {
        let names: Vec<String> = machines.iter().map(|x| shown(x, "name")).collect();
        let hint = if machines.len() == 1 { " Sync is off, so this Omni knows only itself." } else { "" };
        return Err(Error::cli(format!("No machine named {query}. Machines: {}.{hint}", names.join(", "))));
    };
    let own_id = truthy_text(m, "id");
    let update = fleet_row(fleet.as_ref(), |f| match &own_id {
        Some(id) => text(f, "id") == *id,
        None => truthy(f, "current"),
    });
    let now = sys::now();
    if as_json {
        sys::out(&json(&object(vec![
            ("machine", Some(m.clone())),
            ("update", or_null(update.cloned())),
            ("sync_live", view.get("syncLive").cloned()),
            ("last_sync_at", view.get("lastSyncAt").cloned()),
        ])));
        return Ok(exit::OK);
    }
    let here = truthy(m, "here");
    let place = if here {
        "this machine".to_string()
    } else if is(m, "reachability", "offline") && truthy(m, "lastSeen") {
        format!("{}, last seen {}", shown(m, "reachability"), when(m.get("lastSeen"), now))
    } else {
        shown(m, "reachability")
    };
    sys::out(&format!("{} ({place})\n", shown(m, "name")));
    let st = m.get("stats").filter(|s| s.is_truthy());
    let cpu = st.filter(|st| !matches!(st.get("cpu"), Some(JsValue::Null))).map(|st| {
        let cores = truthy_text(st, "cores").map(|cores| format!(" of {cores} cores")).unwrap_or_default();
        let load = st.get("load").filter(|l| l.is_truthy()).map(|l| {
            let each: Vec<String> = l.as_array().unwrap_or_default().iter().map(|x| to_fixed(js::to_number(Some(x)), 2)).collect();
            format!(", load {}", each.join(" "))
        });
        format!("{}%{cores}{}", num(round(js::to_number(st.get("cpu")))), load.unwrap_or_default())
    });
    let memory = st.and_then(|st| st.get("memory")).filter(|m| m.is_truthy()).map(|memory| {
        format!("{} of {} in use", free_size(js::to_number(memory.get("used"))), free_size(js::to_number(memory.get("total"))))
    });
    let delegated = truthy_text(m, "delegated").map(|d| format!(", {d} delegated")).unwrap_or_default();
    let last_change = if here {
        None
    } else if truthy(m, "lastChangeAt") {
        Some(when(m.get("lastChangeAt"), now))
    } else {
        Some("none synced yet".to_string())
    };
    let sync = if here {
        None
    } else if truthy(&view, "syncLive") {
        let last = when(view.get("lastSyncAt"), now);
        Some(format!("live, last synced {}", if last.is_empty() { "never" } else { &last }))
    } else {
        Some("not live: these numbers may be old".to_string())
    };
    sys::out(&fields(&[
        ("turns", Some(format!("{} running, {} queued{delegated}", shown(m, "running"), shown(m, "queued")))),
        ("sub-agents", truthy_text(m, "agents")),
        ("needs you", Some(format!("{} asking for you", plural(m, "needsYou", "thread")))),
        ("cpu", cpu),
        ("memory", memory),
        ("sampled", st.map(|st| when(st.get("sampledAt"), now))),
        ("last change", last_change),
        ("update", update_text(update)),
        ("sync", sync),
    ]));
    Ok(exit::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(json: &str) -> JsValue {
        js::parse(json).unwrap()
    }

    #[test]
    fn words_where_an_update_stands() {
        let text = |json: &str| update_text(Some(&value(json))).unwrap();
        assert_eq!(update_text(None), None);
        assert_eq!(text(r#"{"state":"up-to-date","status":{"version":"1.4.0"}}"#), "up to date (runs 1.4.0)");
        assert_eq!(text(r#"{"state":"available","status":{"available":"1.5.0"}}"#), "1.5.0 available");
        assert_eq!(text(r#"{"state":"available","status":null}"#), "an update available");
        assert_eq!(text(r#"{"state":"downloading","status":{"available":"1.5.0","progress":41.5}}"#), "downloading 1.5.0 (42%)");
        assert_eq!(text(r#"{"state":"downloading","status":{"progress":null}}"#), "downloading an update");
        assert_eq!(
            text(r#"{"state":"ready","status":{"available":"1.5.0","version":"1.4.0"}}"#),
            "1.5.0 downloaded, applies on restart (runs 1.4.0)"
        );
        assert_eq!(
            text(r#"{"state":"waiting","status":{"available":"1.5.0","waitingFor":1}}"#),
            "restarting for 1.5.0 once 1 running turn end"
        );
        assert_eq!(text(r#"{"state":"waiting","status":{}}"#), "restarting for an update once 0 running turns end");
        assert_eq!(text(r#"{"state":"failed","status":{"error":"no  space","version":"1.4.0"}}"#), "update failed: no space (runs 1.4.0)");
        assert_eq!(text(r#"{"state":"offline"}"#), "offline");
        assert_eq!(text(r#"{"state":"paused","status":{"version":"1.4.0"}}"#), "paused (runs 1.4.0)");
    }

    #[test]
    fn words_how_sync_is_doing() {
        let text = |json: &str| sync_text(Some(&value(json)), 0.0).unwrap();
        assert_eq!(sync_text(None, 0.0), None);
        assert_eq!(text(r#"{"configured":false}"#), "off");
        assert_eq!(text(r#"{"configured":true,"signedOut":true}"#), "signed out: sign in again in Settings > Sync");
        assert_eq!(text(r#"{"configured":true,"enabled":false}"#), "paused");
        assert_eq!(
            text(r#"{"configured":true,"enabled":true,"lastError":"relay  down","failures":3}"#),
            "failing (3 in a row): relay down"
        );
        assert_eq!(text(r#"{"configured":true,"enabled":true,"lastError":"relay down","failures":1}"#), "failing: relay down");
        assert_eq!(text(r#"{"configured":true,"enabled":true,"lastSyncAt":null,"pending":2}"#), "on, not synced yet, 2 to push");
    }

    #[test]
    fn finds_a_machine_by_id_name_or_here() {
        let machines =
            value(r#"[{"id":"AB12","name":"omarchy","here":true},{"id":"cd34","name":"MacBook Air"},{"id":null,"name":"cd34"}]"#);
        let machines = machines.as_array().unwrap();
        let name = |q: &str| find_machine(machines, q).map(|m| shown(m, "name"));
        assert_eq!(name(" HERE "), Some("omarchy".to_string()));
        assert_eq!(name("ab12"), Some("omarchy".to_string()));
        assert_eq!(name("macbook air"), Some("MacBook Air".to_string()));
        assert_eq!(name("CD34"), Some("MacBook Air".to_string()));
        assert_eq!(name("nope"), None);
    }
}
