//! JavaScript's string operations on Rust text. A JavaScript string counts UTF-16 units, so widths, cuts and
//! padding here count them too: a table lines up, and a title is cut, where the TypeScript command does it.

use omni_core::js::is_space;

fn is_js_space(c: char) -> bool {
    u16::try_from(c as u32).is_ok_and(is_space)
}

/// `text.length`.
pub fn len16(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `text.slice(0, units)`. A cut through a surrogate pair leaves a half, which prints as U+FFFD as Node prints it.
pub fn slice16(text: &str, units: usize) -> String {
    if text.len() <= units {
        return text.to_string();
    }
    let cut: Vec<u16> = text.encode_utf16().take(units).collect();
    String::from_utf16_lossy(&cut)
}

/// `text.padEnd(width)`.
pub fn pad_end(text: &str, width: usize) -> String {
    let mut out = text.to_string();
    out.extend(std::iter::repeat_n(' ', width.saturating_sub(len16(text))));
    out
}

/// `text.trimEnd()`.
pub fn trim_end(text: &str) -> &str {
    text.trim_end_matches(is_js_space)
}

/// `text.replace(/\n+$/, '')`.
pub fn without_final_newlines(text: &str) -> &str {
    text.trim_end_matches('\n')
}

/// One line of at most `max` units: runs of whitespace become a space, and a longer text ends in an ellipsis.
pub fn clip(text: &str, max: usize) -> String {
    let mut line = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if is_js_space(c) {
            if !in_space {
                line.push(' ');
            }
            in_space = true;
        } else {
            line.push(c);
            in_space = false;
        }
    }
    let line = line.trim_matches(' ');
    if len16(line) > max { format!("{}…", slice16(line, max.saturating_sub(1))) } else { line.to_string() }
}

/// Columns padded to their widest cell. The last one is left as it is.
pub fn table(rows: &[Vec<String>]) -> String {
    let Some(first) = rows.first() else {
        return String::new();
    };
    let widths: Vec<usize> =
        (0..first.len()).map(|col| rows.iter().map(|r| r.get(col).map_or(0, |c| len16(c))).max().unwrap_or(0)).collect();
    let mut out = String::new();
    for (i, row) in rows.iter().enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let mut line = String::new();
        for (col, cell) in row.iter().enumerate() {
            if col > 0 {
                line.push_str("  ");
            }
            if col == row.len() - 1 {
                line.push_str(cell);
            } else {
                line.push_str(&pad_end(cell, widths.get(col).copied().unwrap_or(0)));
            }
        }
        out.push_str(trim_end(&line));
    }
    out.push('\n');
    out
}

/// Key-value lines, keys padded. Rows with no value, or an empty one, are left out.
pub fn fields(rows: &[(&str, Option<String>)]) -> String {
    let kept: Vec<(&str, &str)> = rows.iter().filter_map(|(k, v)| v.as_deref().filter(|v| !v.is_empty()).map(|v| (*k, v))).collect();
    let width = kept.iter().map(|(k, _)| len16(k)).max().unwrap_or(0);
    let lines: Vec<String> = kept.iter().map(|(k, v)| format!("{}  {}", pad_end(k, width), v)).collect();
    format!("{}\n", lines.join("\n"))
}

/// `path.join(a, b)` on a POSIX path: the two joined by a slash, then `.`, `..` and doubled slashes resolved.
pub fn path_join(a: &str, b: &str) -> String {
    let path = format!("{a}/{b}");
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut kept: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if kept.last().is_some_and(|s| *s != "..") {
                    kept.pop();
                } else if !absolute {
                    kept.push("..");
                }
            }
            other => kept.push(other),
        }
    }
    let mut out = kept.join("/");
    if out.is_empty() {
        return if absolute {
            "/"
        } else if trailing {
            "./"
        } else {
            "."
        }
        .to_string();
    }
    if trailing {
        out.push('/');
    }
    if absolute { format!("/{out}") } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_cuts_in_utf16_units() {
        assert_eq!(len16("a😀"), 3);
        assert_eq!(slice16("a😀b", 3), "a😀");
        assert_eq!(slice16("a😀b", 2), "a\u{fffd}");
        assert_eq!(pad_end("😀", 4), "😀  ");
        assert_eq!(pad_end("abcdef", 4), "abcdef");
    }

    #[test]
    fn clips_to_one_line() {
        assert_eq!(clip("  a\n\n b\u{a0}\tc  ", 70), "a b c");
        assert_eq!(clip("abcdef", 6), "abcdef");
        assert_eq!(clip("abcdefg", 6), "abcde…");
        assert_eq!(clip("", 6), "");
    }

    #[test]
    fn lines_up_a_table_and_fields() {
        let rows = vec![vec!["ID".to_string(), "TITLE".to_string()], vec!["abcdef".to_string(), String::new()]];
        assert_eq!(table(&rows), "ID      TITLE\nabcdef\n");
        assert_eq!(table(&[]), "");
        assert_eq!(
            fields(&[("id", Some("1".into())), ("status", None), ("channel", Some("#x".into())), ("run", Some(String::new()))]),
            "id       1\nchannel  #x\n"
        );
        assert_eq!(fields(&[]), "\n");
    }

    #[test]
    fn joins_paths_as_node_does() {
        assert_eq!(path_join("/a/b/", "api-token"), "/a/b/api-token");
        assert_eq!(path_join("/a/../b//c/.", "x"), "/b/c/x");
        assert_eq!(path_join("a/../..", "x"), "../x");
        assert_eq!(path_join("/..", "x"), "/x");
        assert_eq!(path_join("rel", "worktrees"), "rel/worktrees");
    }
}
