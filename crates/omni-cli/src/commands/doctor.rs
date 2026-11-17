//! `omni doctor`: why Omni is not working, without needing the server. Every check reads this machine; the server is
//! asked only whether it answers, and whether it takes the token.

use std::time::Duration;

use omni_core::js::{self, JsValue};

use crate::api;
use crate::args::{self, switch};
use crate::connection::{Client, Connection, TokenSource, describe_source};
use crate::disk::{DiskLevel, disk_level, free_size};
use crate::error::{Error, Result, exit};
use crate::proof::{PROBE_MS, Probe, probe};
use crate::sys::{self, RunResult};
use crate::text::{clip, len16, pad_end, path_join};
use crate::time::rel_time_at;
use crate::val::{json, object, string};
use crate::version::VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Ok,
    Warn,
    Fail,
}

impl Level {
    fn name(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Warn => "warn",
            Self::Fail => "fail",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Warn => "warn",
            Self::Fail => "FAIL",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub name: &'static str,
    pub level: Level,
    pub detail: String,
    /// Lines to show under it: the end of the server log.
    pub lines: Option<Vec<String>>,
}

fn check(name: &'static str, level: Level, detail: impl Into<String>) -> Check {
    Check { name, level, detail: detail.into(), lines: None }
}

const LOGIN: Duration = Duration::from_secs(10);

fn server_check(p: &Probe, conn: &Connection) -> Check {
    let at = &conn.base_url;
    match p {
        Probe::Free => check(
            "server",
            Level::Fail,
            format!(
                "nothing answers on {at}: Omni is not running. Open the Omni app{}.",
                if conn.remote { " on that machine" } else { "" }
            ),
        ),
        Probe::Slow => check(
            "server",
            Level::Fail,
            format!(
                "{at} is taken but did not answer within {}s. If it is Omni, it is stuck or starting: see the log below.",
                PROBE_MS / 1000
            ),
        ),
        Probe::NotOmni { detail } => {
            check("server", Level::Fail, format!("{at} answers, but not as Omni ({detail}). Another program holds the port."))
        }
        Probe::Omni { mine: Some(false) } => {
            check("server", Level::Fail, format!("{at} answers as Omni, but not with this token: another install, or the token changed."))
        }
        Probe::Omni { .. } => check("server", Level::Ok, format!("Omni answers on {at}")),
    }
}

fn token_check(conn: &Connection, p: &Probe) -> Check {
    let place = describe_source(&conn.token_source);
    match &conn.token_source {
        TokenSource::None => return check("token", Level::Fail, format!("none found. {place}.")),
        TokenSource::File { path, .. } => {
            let Some(st) = sys::stat(path) else {
                return check("token", Level::Fail, format!("{place} does not exist. The server writes it on its first start."));
            };
            if conn.token().is_none() {
                return check("token", Level::Fail, format!("{place} is empty or unreadable."));
            }
            if st.mode & 0o077 != 0 {
                return check(
                    "token",
                    Level::Warn,
                    format!("{place} can be read by other users (mode {:o}). It should be 600.", st.mode & 0o777),
                );
            }
        }
        TokenSource::Env => {}
    }
    let mine = match p {
        Probe::Omni { mine } => *mine,
        _ => return check("token", Level::Ok, format!("{place} (not checked: the server is not answering)")),
    };
    // A wrong proof means whatever holds the port is not this install: it does not get the token.
    if mine == Some(false) {
        return check("token", Level::Ok, format!("{place} (not sent: the server on that port is not this install)"));
    }
    // The probe above is the proof, so the client does not ask again.
    match Client::new(conn.clone(), mine == Some(true)).get(api::STATUS) {
        Ok(_) => check("token", Level::Ok, format!("{place}, and the server takes it")),
        Err(e) if e.http_status() == Some(401) => {
            check("token", Level::Fail, format!("{place}: the server refused it. It was rotated or belongs to another install."))
        }
        Err(e) => check("token", Level::Warn, format!("{place}: the server did not say ({})", clip(&e.message(), 80))),
    }
}

fn data_check(conn: &Connection) -> Check {
    let Some(dir) = &conn.data_dir else {
        return check("data", Level::Warn, "unknown. The desktop app's omni command knows it; elsewhere set OMNI_DATA_DIR.");
    };
    if !sys::stat(dir).is_some_and(|st| st.dir) {
        return check("data", Level::Fail, format!("{dir} does not exist."));
    }
    if sys::stat(&path_join(dir, "omni.db")).is_none() {
        return check("data", Level::Warn, format!("{dir} has no omni.db yet: the server has not started with it."));
    }
    check("data", Level::Ok, dir.clone())
}

/// An environment variable exactly as it is set, empty included.
fn env_exact(name: &str) -> Option<String> {
    std::env::var_os(name).map(|v| v.to_string_lossy().into_owned())
}

fn disk_checks(conn: &Connection) -> Vec<Check> {
    let tmp = sys::env_raw("TMPDIR").unwrap_or_else(|| "/tmp".to_string());
    let places = [
        match &conn.data_dir {
            Some(dir) => (dir.clone(), "Omni's data"),
            None => (env_exact("HOME").unwrap_or_else(|| "/".to_string()), "your home folder"),
        },
        (tmp, "the temp folder"),
    ];
    let mut seen: Vec<(u64, u64)> = Vec::new();
    let mut out = Vec::new();
    for (path, what) in places {
        let Some((free, total)) = sys::disk(&path) else { continue };
        // Two folders on one disk read the same: say it once.
        let key = (free.to_bits(), total.to_bits());
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        let text = format!("{} free of {} on the disk with {what} ({path})", free_size(free), free_size(total));
        out.push(match disk_level(free, total) {
            DiskLevel::Ok => check("disk", Level::Ok, text),
            DiskLevel::Low => check("disk", Level::Warn, text),
            DiskLevel::Critical => check("disk", Level::Fail, format!("{text}. Threads stop working when it fills.")),
        });
    }
    out
}

/// Claude Code: `claude auth status --json`, as Settings > Accounts reads it (`apps/server/harness-accounts.ts`).
fn claude_check(r: &RunResult) -> Check {
    if r.missing {
        return check("claude", Level::Warn, "not installed (no claude on PATH)");
    }
    // `null` has no fields to read, which TypeScript counts with an answer that is not JSON.
    let status = match js::parse(&r.stdout) {
        Ok(JsValue::Null) | Err(_) => return check("claude", Level::Warn, "claude auth status did not answer"),
        Ok(status) => status,
    };
    if !matches!(status.get("loggedIn"), Some(JsValue::Bool(true))) {
        return check("claude", Level::Fail, "signed out: run claude and sign in");
    }
    let how: Vec<String> = ["authMethod", "subscriptionType"]
        .iter()
        .filter_map(|key| status.get(key).and_then(JsValue::as_js_string))
        .filter(|s| !s.is_empty())
        .map(js::JsString::to_string_lossy)
        .collect();
    check("claude", Level::Ok, if how.is_empty() { "signed in".to_string() } else { format!("signed in ({})", how.join(", ")) })
}

/// Whether `text` holds `word`, letters compared without their case.
fn says(text: &str, word: &str) -> bool {
    text.as_bytes().windows(word.len()).any(|w| w.eq_ignore_ascii_case(word.as_bytes()))
}

fn codex_check(r: &RunResult) -> Check {
    if r.missing {
        return check("codex", Level::Warn, "not installed (no codex on PATH)");
    }
    // Only the kind of login is repeated: the line can carry a masked API key.
    let said = format!("{}\n{}", r.stdout, r.stderr);
    let (how, key) = if says(&said, "chatgpt") {
        (" (ChatGPT)", false)
    } else if says(&said, "api key") {
        (" (an API key, not the ChatGPT plan Omni runs on)", true)
    } else {
        ("", false)
    };
    match r.code {
        Some(0) => check("codex", if key { Level::Warn } else { Level::Ok }, format!("signed in{how}")),
        None => check("codex", Level::Warn, "codex login status did not answer"),
        Some(_) => check("codex", Level::Fail, "signed out: run codex login"),
    }
}

fn is_js_space(c: char) -> bool {
    u16::try_from(c as u32).is_ok_and(js::is_space)
}

/// The account in gh's "Logged in to github.com account <name>" (or "as <name>" in older versions).
fn gh_account(said: &str) -> Option<&str> {
    const LEAD: &str = "Logged in to github.com ";
    said.match_indices(LEAD).find_map(|(at, _)| {
        let rest = &said[at + LEAD.len()..];
        let name = rest.strip_prefix("account ").or_else(|| rest.strip_prefix("as "))?;
        let end = name.find(is_js_space).unwrap_or(name.len());
        (end > 0).then(|| &name[..end])
    })
}

fn gh_check(r: &RunResult) -> Check {
    if r.missing {
        return check("gh", Level::Warn, "not installed (no gh on PATH): PR features need it");
    }
    // gh prints its status on stderr in older versions and stdout in newer ones. Only the account name is kept.
    let said = format!("{}\n{}", r.stdout, r.stderr);
    match r.code {
        Some(0) => check(
            "gh",
            Level::Ok,
            match gh_account(&said) {
                Some(account) => format!("signed in to github.com as {account}"),
                None => "signed in to github.com".to_string(),
            },
        ),
        None => check("gh", Level::Warn, "gh auth status did not answer"),
        Some(_) => check("gh", Level::Fail, "signed out of github.com: run gh auth login"),
    }
}

const LOG_LINES: usize = 8;

/// Words that mean trouble in a log line, each as a whole word and in any case.
const TROUBLE: [&str; 11] =
    ["error", "fatal", "uncaught", "unhandled", "EADDRINUSE", "ENOSPC", "EDQUOT", "crash", "crashed", "SIGSEGV", "SIGKILL"];

fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn reports_trouble(line: &str) -> bool {
    let bytes = line.as_bytes();
    TROUBLE.iter().any(|word| {
        let word = word.as_bytes();
        bytes.windows(word.len()).enumerate().any(|(at, w)| {
            let starts = at == 0 || !is_word(bytes[at - 1]);
            let ends = bytes.get(at + word.len()).is_none_or(|b| !is_word(*b));
            starts && ends && w.eq_ignore_ascii_case(word)
        })
    })
}

fn log_check(conn: &Connection, server_down: bool) -> Check {
    let Some(file) = &conn.log_file else {
        return check("log", Level::Warn, "unknown. The desktop app's omni command knows where the server log is.");
    };
    let Some(st) = sys::stat(file) else {
        return check("log", if server_down { Level::Warn } else { Level::Ok }, format!("{file} does not exist yet"));
    };
    let text = sys::tail(file, 16_000).unwrap_or_default();
    let lines: Vec<&str> = text.split('\n').filter(|l| !js::trim_str(l).is_empty()).collect();
    let tail = &lines[lines.len().saturating_sub(LOG_LINES)..];
    let trouble = tail.iter().any(|l| reports_trouble(l));
    let detail = format!("{file}, last written {}", rel_time_at(st.mtime_ms, sys::now(), &chrono::Local));
    Check {
        name: "log",
        level: if trouble { Level::Warn } else { Level::Ok },
        detail: if trouble { format!("{detail}. Its last lines report trouble:") } else { detail },
        lines: (server_down || trouble).then(|| tail.iter().map(|l| clip(l, 200)).collect()),
    }
}

fn command_check(conn: &Connection) -> Check {
    match &conn.app {
        None => check("omni", Level::Ok, format!("{VERSION}, not run through the desktop app's command")),
        Some(app) if sys::stat(app).is_none() => {
            check("omni", Level::Fail, format!("{app} is gone. Open the Omni app once and it points this command at itself again."))
        }
        Some(app) => check("omni", Level::Ok, format!("{VERSION}, runs on {app}")),
    }
}

pub fn run_checks() -> Result<Vec<Check>> {
    let conn = Connection::from_env()?;
    let p = probe(&conn);
    // The logins are asked while the server is: each can take its whole time limit.
    let (token, claude, codex, gh) = std::thread::scope(|scope| {
        let claude = scope.spawn(|| claude_check(&sys::run("claude", &["auth", "status", "--json"], LOGIN)));
        let codex = scope.spawn(|| codex_check(&sys::run("codex", &["login", "status"], LOGIN)));
        let gh = scope.spawn(|| gh_check(&sys::run("gh", &["auth", "status", "--hostname", "github.com"], LOGIN)));
        let token = token_check(&conn, &p);
        let joined = |handle: std::thread::ScopedJoinHandle<'_, Check>, name: &'static str| {
            handle.join().unwrap_or_else(|_| check(name, Level::Warn, "the check itself failed"))
        };
        (token, joined(claude, "claude"), joined(codex, "codex"), joined(gh, "gh"))
    });
    let mut checks = vec![command_check(&conn), server_check(&p, &conn), token, data_check(&conn)];
    checks.extend(disk_checks(&conn));
    checks.extend([claude, codex, gh, log_check(&conn, !matches!(p, Probe::Omni { .. }))]);
    Ok(checks)
}

pub fn render_checks(checks: &[Check]) -> String {
    let width = checks.iter().map(|c| len16(c.name)).max().unwrap_or(0);
    let blocks: Vec<String> = checks
        .iter()
        .map(|c| {
            let mut block = format!("{}  {}  {}", pad_end(c.level.label(), 4), pad_end(c.name, width), c.detail);
            for line in c.lines.iter().flatten() {
                block.push_str(&format!("\n{}| {line}", " ".repeat(width + 8)));
            }
            block
        })
        .collect();
    format!("{}\n", blocks.join("\n"))
}

fn check_json(c: &Check) -> JsValue {
    object(vec![
        ("name", string(c.name)),
        ("level", string(c.level.name())),
        ("detail", string(&c.detail)),
        ("lines", c.lines.as_ref().map(|lines| JsValue::Array(lines.iter().map(|l| JsValue::str(l)).collect()))),
    ])
}

pub fn doctor_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, &[switch("json")])?;
    if let Some(extra) = p.word(0) {
        return Err(Error::usage(format!("unexpected {extra}")));
    }
    let checks = run_checks()?;
    let failed = checks.iter().any(|c| c.level == Level::Fail);
    if p.flag("json") {
        sys::out(&json(&object(vec![
            ("ok", Some(JsValue::Bool(!failed))),
            ("checks", Some(JsValue::Array(checks.iter().map(check_json).collect()))),
        ])));
    } else {
        sys::out(&render_checks(&checks));
    }
    Ok(if failed { exit::FAILED } else { exit::OK })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ran(code: Option<i32>, stdout: &str, stderr: &str) -> RunResult {
        RunResult { code, stdout: stdout.to_string(), stderr: stderr.to_string(), missing: false }
    }

    fn missing() -> RunResult {
        RunResult { code: None, stdout: String::new(), stderr: String::new(), missing: true }
    }

    #[test]
    fn reads_the_claude_login() {
        let said = |stdout: &str| {
            let c = claude_check(&ran(Some(0), stdout, ""));
            (c.level, c.detail)
        };
        assert_eq!(
            said(r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}"#),
            (Level::Ok, "signed in (claude.ai, max)".to_string())
        );
        assert_eq!(said(r#"{"loggedIn":true,"authMethod":"","subscriptionType":5}"#), (Level::Ok, "signed in".to_string()));
        assert_eq!(said(r#"{"loggedIn":"true"}"#), (Level::Fail, "signed out: run claude and sign in".to_string()));
        assert_eq!(said("[]"), (Level::Fail, "signed out: run claude and sign in".to_string()));
        assert_eq!(said("null"), (Level::Warn, "claude auth status did not answer".to_string()));
        assert_eq!(said("not json"), (Level::Warn, "claude auth status did not answer".to_string()));
        assert_eq!(claude_check(&missing()).detail, "not installed (no claude on PATH)");
    }

    #[test]
    fn reads_the_codex_login() {
        let said = |code: Option<i32>, stdout: &str, stderr: &str| {
            let c = codex_check(&ran(code, stdout, stderr));
            (c.level, c.detail)
        };
        assert_eq!(said(Some(0), "Logged in using ChatGPT", ""), (Level::Ok, "signed in (ChatGPT)".to_string()));
        assert_eq!(
            said(Some(0), "", "Logged in using an API Key - sk-***"),
            (Level::Warn, "signed in (an API key, not the ChatGPT plan Omni runs on)".to_string())
        );
        assert_eq!(said(Some(0), "ok", ""), (Level::Ok, "signed in".to_string()));
        assert_eq!(said(Some(1), "Not logged in", ""), (Level::Fail, "signed out: run codex login".to_string()));
        assert_eq!(said(None, "", ""), (Level::Warn, "codex login status did not answer".to_string()));
    }

    #[test]
    fn reads_the_github_account() {
        assert_eq!(gh_account("  ✓ Logged in to github.com account ben-askphill (keyring)"), Some("ben-askphill"));
        assert_eq!(gh_account("Logged in to github.com as octocat\n"), Some("octocat"));
        assert_eq!(gh_account("Logged in to github.com as \nLogged in to github.com account second"), Some("second"));
        assert_eq!(gh_account("Logged in to github.com with a token"), None);
        assert_eq!(gh_check(&ran(Some(0), "", "Logged in to github.com as octocat")).detail, "signed in to github.com as octocat");
        assert_eq!(gh_check(&ran(Some(0), "", "")).detail, "signed in to github.com");
        assert_eq!(gh_check(&ran(Some(1), "", "")).level, Level::Fail);
        assert_eq!(gh_check(&ran(None, "", "")).level, Level::Warn);
    }

    #[test]
    fn spots_trouble_in_a_log_line() {
        for line in [
            "Error: listen EADDRINUSE",
            "the server CRASHED.",
            "fatal",
            "write ENOSPC: no space",
            "got SIGKILL",
            "an unhandled rejection",
            "x: error",
        ] {
            assert!(reports_trouble(line), "{line}");
        }
        for line in ["errors: 0", "no_error", "crashes", "terror", "started on :4747", ""] {
            assert!(!reports_trouble(line), "{line}");
        }
    }

    #[test]
    fn lines_up_the_checks() {
        let checks = [
            check("omni", Level::Ok, "dev"),
            Check {
                name: "log",
                level: Level::Warn,
                detail: "trouble:".to_string(),
                lines: Some(vec!["one".to_string(), "two".to_string()]),
            },
            check("server", Level::Fail, "down"),
        ];
        assert_eq!(
            render_checks(&checks),
            "ok    omni    dev\nwarn  log     trouble:\n              | one\n              | two\nFAIL  server  down\n"
        );
    }
}
