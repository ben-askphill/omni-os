//! The usage text, one block per command. `docs/user/cli.md` says the same at more length.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    New,
    Send,
    Threads,
    Show,
    Status,
    Doctor,
    Open,
}

pub const COMMANDS: [Command; 7] =
    [Command::New, Command::Send, Command::Threads, Command::Show, Command::Status, Command::Doctor, Command::Open];

impl Command {
    pub fn named(name: &str) -> Option<Self> {
        COMMANDS.into_iter().find(|c| c.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Send => "send",
            Self::Threads => "threads",
            Self::Show => "show",
            Self::Status => "status",
            Self::Doctor => "doctor",
            Self::Open => "open",
        }
    }

    fn text(self) -> &'static str {
        match self {
            Self::New => {
                r#"omni new "<prompt>" [-c <channel>] [-r <role>] [-m <model>] [--wait] [--json] [--open]
  Start a thread. The prompt can come on stdin ("-", or piped with no prompt).
  -c, --channel   channel id (default: the role's channel, else inbox)
  -r, --role      crew role id (builder, researcher, ...)
  -m, --model     model id or alias (opus, sonnet, haiku)
  -w, --wait      wait for the turn to end and print the reply; exit 0 done, 1 failed or stopped, 2 needs you
      --json      print JSON
  -o, --open      open the new thread in the desktop app or the browser
  Inside an Omni thread, the new thread is filed under it and reports back to it."#
            }
            Self::Send => {
                r#"omni send <thread> "<message>" [--queue | --interrupt] [--wait] [--json]
  Message a thread. <thread> is its id, its first 8 characters, a link, or "parent" inside a thread.
  The message can come on stdin ("-", or piped with no message).
  By default a busy thread reads it at its next step (steer).
      --queue      run it after the current turn instead
      --interrupt  stop the current turn, then run it
  -w, --wait       wait for the turn to end and print the reply (exit codes as for new)
      --json       print JSON"#
            }
            Self::Threads => {
                r"omni threads [--needs-you] [--running] [-c <channel>] [-n <count>] [--json]
  List the latest threads, newest activity first.
      --needs-you  only what waits on you: unread results, questions, failures
      --running    only threads running now
  -c, --channel    one channel
  -n, --limit      how many (default 20)
      --json       print JSON"
            }
            Self::Show => {
                r"omni show <thread> [--json]
  A thread's status, where it runs, what waits on you, and its latest reply."
            }
            Self::Status => {
                r#"omni status [--machine <name>] [--json]
  This Omni's version, running turns, Needs you, sync and update state.
      --machine  another synced machine (or "here"), as this Omni sees it"#
            }
            Self::Doctor => {
                r"omni doctor [--json]
  Check this install without needing the server: the port, the token, the data folder, disk space,
  the Claude, Codex and GitHub logins, and the server log. Exit 1 when a check fails."
            }
            Self::Open => {
                r#"omni open [<thread> | <channel> | .] [--pair]
  Open a thread or channel in the desktop app, or the browser when there is no app.
  "." is the thread whose worktree you are in, or the channel whose folder you are in. Nothing opens Omni itself.
      --pair  print a link that pairs a browser (such as your phone) and opens it there, instead of opening it"#
            }
        }
    }

    /// One command's usage.
    pub fn usage(self) -> String {
        format!("{}\n", self.text())
    }
}

/// Every command on a line, then the environment and the exit codes.
pub fn usage() -> String {
    let lines: Vec<String> = COMMANDS
        .iter()
        .map(|c| {
            let first = c.text().lines().next().unwrap_or_default();
            format!("  {}", first.strip_prefix("omni ").unwrap_or(first))
        })
        .collect();
    format!(
        "omni: Omni's command line

Commands:
{}

omni <command> --help shows one command. docs/user/cli.md has the rest.

Environment: OMNI_URL (default http://127.0.0.1:4747), OMNI_TOKEN or OMNI_TOKEN_FILE (default: the install's
api-token). Inside an Omni thread these are set already.
Exit codes: 0 ok, 1 failed (--wait, doctor), 2 needs you (--wait), 3 Omni refused or is unreachable, 64 bad usage.
",
        lines.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_every_command_once() {
        for c in COMMANDS {
            assert_eq!(Command::named(c.name()), Some(c));
            assert!(c.usage().starts_with(&format!("omni {}", c.name())));
            assert!(c.usage().ends_with('\n'));
        }
        assert_eq!(Command::named("help"), None);
        assert_eq!(usage().matches("\n  ").count(), COMMANDS.len());
    }
}
