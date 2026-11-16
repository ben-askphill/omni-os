//! `omni open`: a thread or channel in the desktop app, else in the browser. The app takes the page as `--route`,
//! also on a second launch while it runs (`apps/desktop/src/main.ts`), and as an omni:// link
//! (`apps/cli/src/commands/open.ts`).

use crate::api;
use crate::args::{self, switch};
use crate::connection::{Client, encode};
use crate::error::{Error, Result, exit};
use crate::resolve::{is_uuid, looks_like_thread, resolve_thread};
use crate::sys;
use crate::text::{len16, path_join};
use crate::val::{text, truthy_text};

/// The .app bundle a Mac binary sits in (/Applications/Omni.app/Contents/MacOS/Omni), or `None`.
pub fn mac_bundle(binary: &str) -> Option<&str> {
    binary.find(".app/Contents/MacOS/").map(|i| &binary[..i + ".app".len()])
}

/// How to start the app on `route`: `open` on a Mac (a second launch hands the route to the running app), else the
/// binary or AppImage.
pub fn app_launch(app: &str, mac: bool, route: &str) -> (String, Vec<String>) {
    // One token: Chromium moves an argument that is not a switch to the end of a second launch's argv.
    let arg = format!("--route={route}");
    match mac_bundle(app).filter(|_| mac) {
        Some(bundle) => ("open".to_string(), vec!["-n".to_string(), "-a".to_string(), bundle.to_string(), "--args".to_string(), arg]),
        None => (app.to_string(), vec![arg]),
    }
}

pub fn open_route(c: &Client, route: &str, quiet: bool) -> Result<()> {
    let say = |text: String| {
        if !quiet {
            sys::out(&text);
        }
    };
    // The app shows the server it runs with: only a page of that server opens there.
    if let Some(app) = c.conn.app.as_deref().filter(|app| !c.conn.remote && sys::stat(app).is_some()) {
        let (bin, args) = app_launch(app, sys::is_mac(), route);
        if sys::launch(&bin, &args) {
            say(format!("Opened {route} in the Omni app.\n"));
            return Ok(());
        }
    }
    let url = c.link(route);
    if sys::launch(if sys::is_mac() { "open" } else { "xdg-open" }, std::slice::from_ref(&url)) {
        say(format!("Opened {url} in your browser.\n"));
        return Ok(());
    }
    Err(Error::cli(format!("Could not start a browser. Open {url}")))
}

fn is_sep(b: u8) -> bool {
    b == b'/' || b == b'\\'
}

/// The thread whose worktree `cwd` is in: the id after a `worktrees` folder, in lower case.
fn worktree_thread(cwd: &str) -> Option<String> {
    const FOLDER: &[u8] = b"worktrees";
    let bytes = cwd.as_bytes();
    (0..bytes.len()).find_map(|i| {
        let id_at = i + 1 + FOLDER.len() + 1;
        let id = cwd.get(id_at..id_at + 36)?;
        let named = is_sep(bytes[i]) && bytes[i + 1..i + 1 + FOLDER.len()].eq_ignore_ascii_case(FOLDER) && is_sep(bytes[id_at - 1]);
        let ends = bytes.get(id_at + 36).is_none_or(|b| is_sep(*b));
        (named && is_uuid(id) && ends).then(|| id.to_lowercase())
    })
}

/// `path` is `dir` or under it.
fn within(dir: &str, path: &str) -> bool {
    path == dir || if dir.ends_with('/') { path.starts_with(dir) } else { path.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/')) }
}

/// "." : the thread whose worktree this is, the thread this runs in, or the channel whose folder this is.
fn here_route(c: &Client) -> Result<String> {
    let cwd = sys::cwd();
    let worktrees = c.conn.data_dir.as_deref().map(|dir| path_join(dir, "worktrees"));
    if let Some(id) = worktree_thread(&cwd).filter(|_| worktrees.as_deref().is_none_or(|dir| within(dir, &cwd))) {
        return Ok(format!("#/t/{id}"));
    }
    if let Some(thread) = &c.conn.thread {
        return Ok(format!("#/t/{thread}"));
    }
    let channels = c.get(api::CHANNELS)?;
    let mut best: Option<(String, usize)> = None;
    for channel in channels.as_array().unwrap_or_default() {
        for key in ["repo_path", "base_dir"] {
            let Some(dir) = truthy_text(channel, key) else { continue };
            if !within(dir.trim_end_matches(['/', '\\']), &cwd) {
                continue;
            }
            let depth = len16(&dir);
            if best.as_ref().is_none_or(|(_, deepest)| depth > *deepest) {
                best = Some((text(channel, "id"), depth));
            }
        }
    }
    match best {
        Some((id, _)) => Ok(format!("#/c/{}", encode(&id))),
        None => Err(Error::cli(format!("No channel has {cwd} as its folder. Name a thread or channel instead."))),
    }
}

fn route_for(c: &Client, target: &str) -> Result<String> {
    if target == "." {
        return here_route(c);
    }
    if looks_like_thread(target)? {
        return Ok(format!("#/t/{}", encode(&resolve_thread(c, target)?)));
    }
    match c.get(&api::channel(target)) {
        Ok(channel) => Ok(format!("#/c/{}", encode(&text(&channel, "id")))),
        Err(e) if e.http_status() == Some(404) => Err(Error::cli(format!("No channel or thread named {target}."))),
        Err(e) => Err(e),
    }
}

pub fn open_command(argv: &[String]) -> Result<i32> {
    let p = args::parse(argv, &[switch("pair")])?;
    if let Some(extra) = p.word(1).filter(|e| !e.is_empty()) {
        return Err(Error::usage(format!("unexpected {extra}")));
    }
    if p.word(0) == Some("") {
        return Err(Error::usage("say which thread or channel to open"));
    }
    let c = Client::from_env()?;
    let route = match p.word(0) {
        Some(target) => route_for(&c, target)?,
        None => "#/".to_string(),
    };
    if p.flag("pair") {
        // The page swaps ?pair= for a session cookie and drops it from the address bar (apps/web/src/components/Pair.tsx).
        let Some(token) = c.conn.token() else {
            return Err(Error::cli("No API token to pair with. Set OMNI_TOKEN, or run this on the machine Omni runs on."));
        };
        // The link carries the token: it names only a server that proved it holds it.
        c.prove()?;
        sys::out(&format!("{}?pair={}\n", c.link(&route), encode(&token)));
        return Ok(exit::OK);
    }
    open_route(&c, &route, false)?;
    Ok(exit::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_the_app_on_a_route() {
        assert_eq!(mac_bundle("/Applications/Omni.app/Contents/MacOS/Omni"), Some("/Applications/Omni.app"));
        assert_eq!(mac_bundle("/opt/Omni.AppImage"), None);
        let (bin, args) = app_launch("/Applications/Omni.app/Contents/MacOS/Omni", true, "#/t/abc");
        assert_eq!(
            (bin.as_str(), args),
            ("open", vec!["-n".to_string(), "-a".into(), "/Applications/Omni.app".into(), "--args".into(), "--route=#/t/abc".into()])
        );
        let (bin, args) = app_launch("/Applications/Omni.app/Contents/MacOS/Omni", false, "#/");
        assert_eq!((bin.as_str(), args), ("/Applications/Omni.app/Contents/MacOS/Omni", vec!["--route=#/".to_string()]));
        let (bin, args) = app_launch("/opt/Omni.AppImage", true, "#/");
        assert_eq!((bin.as_str(), args), ("/opt/Omni.AppImage", vec!["--route=#/".to_string()]));
    }

    #[test]
    fn finds_the_thread_a_worktree_belongs_to() {
        let id = "B10B4545-f440-41dc-a076-29c0fa829259";
        let lower = Some(id.to_lowercase());
        assert_eq!(worktree_thread(&format!("/data/worktrees/{id}")), lower);
        assert_eq!(worktree_thread(&format!("/data/WorkTrees/{id}/apps/cli")), lower);
        assert_eq!(worktree_thread(&format!("C:\\data\\worktrees\\{id}\\apps")), lower);
        assert_eq!(worktree_thread(&format!("/data/worktrees/{id}x")), None);
        assert_eq!(worktree_thread(&format!("/data/my-worktrees/{id}")), None);
        assert_eq!(worktree_thread(&format!("worktrees/{id}")), None);
        assert_eq!(worktree_thread("/data/worktrees/not-an-id"), None);
        assert_eq!(worktree_thread("/data/worktrees/é"), None);
    }

    #[test]
    fn knows_a_folder_from_its_neighbour() {
        assert!(within("/repo", "/repo"));
        assert!(within("/repo", "/repo/apps"));
        assert!(within("/repo/", "/repo/apps"));
        assert!(!within("/repo", "/repo-two"));
        assert!(!within("/repo/apps", "/repo"));
        assert!(within("", "/anything"));
    }
}
