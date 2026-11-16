//! What a thread argument names: a full id, the first characters of one, a link to it, or `parent`
//! (`apps/cli/src/resolve.ts`).

use crate::connection::Client;
use crate::error::{Error, Result};
use crate::format::short_id;
use crate::val::{part, text, truthy_text};

/// How many of the latest threads a short id is looked for in.
const SEARCHED: u32 = 500;

fn is_hex(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

/// `8-4-4-4-12` hex digits, in either case.
pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36 && b.iter().enumerate().all(|(i, &c)| if matches!(i, 8 | 13 | 18 | 23) { c == b'-' } else { is_hex(c) })
}

/// The start of an id: a hex digit, then 3 to 35 more hex digits or dashes.
fn is_prefix(s: &str) -> bool {
    let b = s.as_bytes();
    (4..=36).contains(&b.len()) && is_hex(b[0]) && b[1..].iter().all(|&c| is_hex(c) || c == b'-')
}

/// `decodeURIComponent`. `None` where JavaScript throws: a `%` without two hex digits, or bytes that are not UTF-8.
fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok().filter(|_| hex.bytes().all(is_hex))?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The id in a Web UI link such as `http://127.0.0.1:4747/#/t/<id>`: `Ok(None)` when the text holds no such link.
pub fn id_from_link(s: &str) -> Result<Option<String>> {
    let is_space = |c: char| u16::try_from(c as u32).is_ok_and(omni_core::js::is_space);
    // The id needs a character of its own: a `#/t/` with none is passed over for a later one.
    for (at, _) in s.match_indices("#/t/") {
        let rest = &s[at + 4..];
        let end = rest.find(|c: char| matches!(c, '/' | '?' | '#') || is_space(c)).unwrap_or(rest.len());
        if end == 0 {
            continue;
        }
        return match decode(&rest[..end]) {
            Some(id) => Ok(Some(id)),
            None => Err(Error::cli(format!("{s} is not a link this command can read: its id is not valid percent-encoding."))),
        };
    }
    Ok(None)
}

pub fn looks_like_thread(s: &str) -> Result<bool> {
    Ok(s == "parent" || is_uuid(s) || is_prefix(s) || id_from_link(s)?.is_some())
}

pub fn resolve_thread(c: &Client, arg: &str) -> Result<String> {
    if arg == "parent" {
        let Some(own) = &c.conn.thread else {
            return Err(Error::cli("`parent` only works inside an Omni thread (OMNI_THREAD_ID is not set)."));
        };
        let me = c.get(&crate::api::thread(own))?;
        return truthy_text(part(&me, "thread")?, "parent_id")
            .ok_or_else(|| Error::cli(format!("Thread {} has no parent: no other thread started it.", short_id(own))));
    }
    if let Some(linked) = id_from_link(arg)?.filter(|id| !id.is_empty()) {
        return Ok(linked);
    }
    if is_uuid(arg) {
        return Ok(arg.to_lowercase());
    }
    if !is_prefix(arg) {
        return Err(Error::cli(format!("{arg} is not a thread id. Use the id, its first 8 characters, a link to it, or parent.")));
    }
    let prefix = arg.to_lowercase();
    let threads = c.get(&crate::api::threads(None, false, f64::from(SEARCHED)))?;
    let found: Vec<String> =
        threads.as_array().unwrap_or_default().iter().map(|t| text(t, "id")).filter(|id| id.starts_with(&prefix)).collect();
    match found.as_slice() {
        [one] => Ok(one.clone()),
        [] => Err(Error::cli(format!("No thread among the latest {SEARCHED} starts with {arg}. Use its full id."))),
        many => Err(Error::cli(format!(
            "{arg} matches {} threads: {}. Use more of the id.",
            many.len(),
            many.iter().map(|id| short_id(id)).collect::<Vec<_>>().join(", ")
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_ids_prefixes_and_links_apart() {
        assert!(is_uuid("11111111-1111-4111-8111-111111111111"));
        assert!(is_uuid("ABCDEF12-3456-4789-8ABC-DEF012345678"));
        assert!(!is_uuid("11111111-1111-4111-8111-11111111111"));
        assert!(!is_uuid("11111111-1111-4111-8111-11111111111g"));
        assert!(is_prefix("abcd"));
        assert!(is_prefix("1111-"));
        assert!(!is_prefix("abc"));
        assert!(!is_prefix("-abc"));
        assert!(!is_prefix("inbox"));
        assert!(looks_like_thread("parent").unwrap());
        assert!(!looks_like_thread("my-channel").unwrap());
    }

    #[test]
    fn reads_the_id_out_of_a_link() {
        let link = |s: &str| id_from_link(s).unwrap();
        assert_eq!(link("http://127.0.0.1:4747/#/t/abc?x=1"), Some("abc".to_string()));
        assert_eq!(link("#/t/a%20b/more"), Some("a b".to_string()));
        assert_eq!(link("#/t/%E2%82%AC"), Some("€".to_string()));
        assert_eq!(link("#/t/"), None);
        assert_eq!(link("#/t/#/t/x"), Some("x".to_string()));
        assert_eq!(link("#/c/inbox"), None);
        assert!(id_from_link("#/t/%zz").is_err());
        assert!(id_from_link("#/t/%E2%82").is_err());
    }
}
