//! A small option parser: `--name value`, `--name=value`, `-n value`, switches, `--` and `-` for stdin.

use crate::error::{Error, Result};

pub struct Spec {
    pub name: &'static str,
    /// One letter, used as `-x`.
    pub short: Option<&'static str>,
    /// Takes a value. Otherwise it is a switch.
    pub value: bool,
}

/// A switch.
pub const fn switch(name: &'static str) -> Spec {
    Spec { name, short: None, value: false }
}

pub const fn short_switch(name: &'static str, short: &'static str) -> Spec {
    Spec { name, short: Some(short), value: false }
}

/// An option that takes a value.
pub const fn value(name: &'static str) -> Spec {
    Spec { name, short: None, value: true }
}

pub const fn short_value(name: &'static str, short: &'static str) -> Spec {
    Spec { name, short: Some(short), value: true }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Parsed {
    pub positional: Vec<String>,
    /// A switch holds `None`, a value option its last value.
    flags: Vec<(&'static str, Option<String>)>,
}

impl Parsed {
    /// A switch that was given.
    pub fn flag(&self, name: &str) -> bool {
        self.flags.iter().any(|(n, v)| *n == name && v.is_none())
    }

    /// The last value an option was given.
    pub fn value(&self, name: &str) -> Option<&str> {
        self.flags.iter().rev().find(|(n, _)| *n == name).and_then(|(_, v)| v.as_deref())
    }

    /// The positional argument at `index`, when it is there.
    pub fn word(&self, index: usize) -> Option<&str> {
        self.positional.get(index).map(String::as_str)
    }
}

pub fn parse(argv: &[String], specs: &[Spec]) -> Result<Parsed> {
    let mut parsed = Parsed::default();
    let mut i = 0;
    while i < argv.len() {
        let arg = &argv[i];
        i += 1;
        if arg == "--" {
            parsed.positional.extend(argv[i..].iter().cloned());
            break;
        }
        if arg == "-" || !arg.starts_with('-') {
            parsed.positional.push(arg.clone());
            continue;
        }
        let long = arg.strip_prefix("--");
        let (key, inline) = match long {
            Some(long) => long.split_once('=').map_or((long, None), |(key, value)| (key, Some(value))),
            None => (&arg[1..], None),
        };
        let spec = specs.iter().find(|s| if long.is_some() { s.name == key } else { s.short == Some(key) });
        let Some(spec) = spec.filter(|_| !key.is_empty()) else {
            return Err(Error::usage(format!("unknown option {arg}")));
        };
        if !spec.value {
            if inline.is_some() {
                return Err(Error::usage(format!("--{} takes no value", spec.name)));
            }
            parsed.flags.push((spec.name, None));
            continue;
        }
        let value = match inline {
            Some(value) => Some(value.to_string()),
            None => {
                i += 1;
                argv.get(i - 1).cloned()
            }
        };
        match value.filter(|v| !v.is_empty()) {
            Some(value) => parsed.flags.push((spec.name, Some(value))),
            None => return Err(Error::usage(format!("--{} needs a value", spec.name))),
        }
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPECS: &[Spec] = &[short_value("channel", "c"), short_switch("wait", "w"), switch("json")];

    fn run(args: &[&str]) -> Result<Parsed> {
        parse(&args.iter().map(|a| (*a).to_string()).collect::<Vec<_>>(), SPECS)
    }

    #[test]
    fn reads_options_in_every_form() {
        let p = run(&["hello", "--channel", "a", "-c", "b", "--channel=c=d", "-w", "--json", "-", "world"]).unwrap();
        assert_eq!(p.positional, ["hello", "-", "world"]);
        assert_eq!(p.value("channel"), Some("c=d"));
        assert!(p.flag("wait") && p.flag("json"));
        assert!(!p.flag("channel"));
        assert_eq!(p.value("wait"), None);
    }

    #[test]
    fn everything_after_two_dashes_is_a_word() {
        let p = run(&["a", "--", "--json", "-w", "--"]).unwrap();
        assert_eq!(p.positional, ["a", "--json", "-w", "--"]);
        assert!(!p.flag("json"));
    }

    #[test]
    fn a_value_option_takes_the_next_argument_whatever_it_is() {
        assert_eq!(run(&["--channel", "--json"]).unwrap().value("channel"), Some("--json"));
    }

    #[test]
    fn refuses_what_it_does_not_know() {
        let message = |args: &[&str]| run(args).unwrap_err().message();
        assert_eq!(message(&["--nope"]), "unknown option --nope");
        assert_eq!(message(&["-x"]), "unknown option -x");
        assert_eq!(message(&["-cfoo"]), "unknown option -cfoo");
        assert_eq!(message(&["--=x"]), "unknown option --=x");
        assert_eq!(message(&["--json=1"]), "--json takes no value");
        assert_eq!(message(&["--channel"]), "--channel needs a value");
        assert_eq!(message(&["--channel="]), "--channel needs a value");
        assert_eq!(message(&["-c", ""]), "--channel needs a value");
    }
}
