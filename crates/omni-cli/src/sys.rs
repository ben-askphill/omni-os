//! Everything the command touches outside itself: the environment, the clocks, files, disks and other programs.
//! `apps/cli/src/node-io.ts` is the same layer over Node.

use std::io::{IsTerminal, Read, Seek, SeekFrom, Write};
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use omni_core::js;

/// The desktop app's shim runs the TypeScript command on the app's own binary with this set. A program this command
/// starts must not inherit it, or an Electron app would act as Node.
const SHIM_ONLY: &str = "ELECTRON_RUN_AS_NODE";

/// An environment variable with something in it, trimmed. Blank counts as not set.
pub fn env(name: &str) -> Option<String> {
    let value = std::env::var_os(name)?;
    let value = value.to_string_lossy();
    let trimmed = js::trim_str(&value);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// An environment variable as it is, when it holds anything.
pub fn env_raw(name: &str) -> Option<String> {
    std::env::var_os(name).map(|v| v.to_string_lossy().into_owned()).filter(|v| !v.is_empty())
}

pub fn cwd() -> String {
    std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn is_mac() -> bool {
    cfg!(target_os = "macos")
}

pub fn out(text: &str) {
    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(text.as_bytes()).and_then(|()| stdout.flush());
}

pub fn err(text: &str) {
    let _ = std::io::stderr().lock().write_all(text.as_bytes());
}

/// Everything piped in, or `None` when stdin is a terminal.
pub fn stdin() -> Option<String> {
    let mut stdin = std::io::stdin().lock();
    if stdin.is_terminal() {
        return None;
    }
    let mut bytes = Vec::new();
    let _ = stdin.read_to_end(&mut bytes);
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn sleep(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

/// Milliseconds since 1970, as `Date.now()`.
pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

/// A random version 4 UUID, as `crypto.randomUUID()`.
pub fn uuid() -> String {
    use ring::rand::SecureRandom;
    let mut b = [0u8; 16];
    ring::rand::SystemRandom::new().fill(&mut b).expect("the system has random bytes");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

pub struct RunResult {
    /// The exit code, or `None` when it was killed (its timeout, or more output than is read).
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// The program is not installed (not on PATH).
    pub missing: bool,
}

/// The most output read from a program before it is stopped: Node's `maxBuffer` for `execFile`.
const MAX_OUTPUT: usize = 1024 * 1024;

/// Runs a program for its output. Never fails: a program that is not there is `missing`.
pub fn run(bin: &str, args: &[&str], timeout: Duration) -> RunResult {
    let spawned =
        Command::new(bin).args(args).env_remove(SHIM_ONLY).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            let missing = matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied);
            return RunResult { code: if missing { None } else { Some(1) }, stdout: String::new(), stderr: String::new(), missing };
        }
    };
    // Held open, not closed: Node leaves a child's stdin open too, so a program that reads it waits here as there.
    let _stdin = child.stdin.take();
    let (tx, rx) = mpsc::channel::<(usize, Option<Vec<u8>>)>();
    let mut readers = Vec::new();
    let streams: [Option<Box<dyn Read + Send>>; 2] =
        [child.stdout.take().map(|s| Box::new(s) as _), child.stderr.take().map(|s| Box::new(s) as _)];
    for (which, stream) in streams.into_iter().enumerate() {
        let Some(mut stream) = stream else { continue };
        let tx = tx.clone();
        readers.push(std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send((which, Some(chunk[..n].to_vec()))).is_err() {
                            return;
                        }
                    }
                }
            }
            let _ = tx.send((which, None));
        }));
    }
    drop(tx);
    let deadline = Instant::now() + timeout;
    let mut output = [Vec::new(), Vec::new()];
    let mut open = readers.len();
    let mut killed = false;
    while open > 0 {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok((which, Some(bytes))) => {
                let room = MAX_OUTPUT.saturating_sub(output[which].len());
                output[which].extend_from_slice(&bytes[..bytes.len().min(room)]);
                if bytes.len() > room {
                    killed = true;
                    break;
                }
            }
            Ok((_, None)) => open -= 1,
            Err(_) => {
                killed = true;
                break;
            }
        }
    }
    let code = if killed {
        let _ = child.kill();
        let _ = child.wait();
        None
    } else {
        // Its output ended; the exit follows unless it closed its output and kept running.
        loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status.code().unwrap_or(1)),
                Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        }
    };
    let [stdout, stderr] = output;
    RunResult {
        code,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        missing: false,
    }
}

/// Starts a program and leaves it running on its own (the app, a browser). False when it could not start.
pub fn launch(bin: &str, args: &[String]) -> bool {
    Command::new(bin)
        .args(args)
        .env_remove(SHIM_ONLY)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .is_ok()
}

pub fn read_file(path: &str) -> Option<String> {
    std::fs::read(path).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub struct FileStat {
    pub mode: u32,
    /// When it was last written, in milliseconds since 1970.
    pub mtime_ms: f64,
    pub dir: bool,
}

pub fn stat(path: &str) -> Option<FileStat> {
    let meta = std::fs::metadata(path).ok()?;
    Some(FileStat {
        mode: meta.mode(),
        mtime_ms: (meta.mtime() as f64) * 1000.0 + (meta.mtime_nsec() as f64 / 1e6).floor(),
        dir: meta.is_dir(),
    })
}

/// Free and total bytes of the disk `path` is on, or `None` when it cannot be read.
pub fn disk(path: &str) -> Option<(f64, f64)> {
    let s = rustix::fs::statfs(path).ok()?;
    let block = s.f_bsize as f64;
    Some((s.f_bavail as f64 * block, s.f_blocks as f64 * block))
}

/// The last `bytes` of a file, or `None`.
pub fn tail(path: &str, bytes: u64) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let length = size.min(bytes);
    file.seek(SeekFrom::Start(size - length)).ok()?;
    let mut buf = Vec::with_capacity(length as usize);
    file.take(length).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_version_4_uuids() {
        let id = uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
        assert_ne!(id, uuid());
    }

    #[test]
    fn runs_a_program_for_its_output() {
        let r = run("sh", &["-c", "printf out; printf err >&2; exit 3"], Duration::from_secs(5));
        assert_eq!((r.code, r.stdout.as_str(), r.stderr.as_str(), r.missing), (Some(3), "out", "err", false));
    }

    #[test]
    fn says_a_program_is_missing() {
        let r = run("omni-no-such-program", &[], Duration::from_secs(5));
        assert!(r.missing);
        assert_eq!(r.code, None);
    }

    #[test]
    fn stops_a_program_that_does_not_answer() {
        let started = Instant::now();
        let r = run("sh", &["-c", "sleep 30"], Duration::from_millis(200));
        assert_eq!(r.code, None);
        assert!(!r.missing);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn stops_a_program_that_says_too_much() {
        let r = run("sh", &["-c", "while :; do printf '%01000d' 0; done"], Duration::from_secs(20));
        assert_eq!(r.code, None);
        assert_eq!(r.stdout.len(), MAX_OUTPUT);
    }

    #[test]
    fn a_program_killed_by_a_signal_reads_as_failed() {
        let r = run("sh", &["-c", "kill -9 $$"], Duration::from_secs(5));
        assert_eq!(r.code, Some(1));
    }
}
