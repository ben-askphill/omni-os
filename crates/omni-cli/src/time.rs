//! Times as the TypeScript command prints them (`packages/shared/format.ts`, `ran-on.ts`): "just now", "12m ago",
//! "Yesterday 14:05", "Mon 09:30", "5 Jan". The words depend on the local time zone, so every function here takes
//! the zone: the command passes the machine's, the tests pass named ones and compare with what Node printed.

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, Offset, TimeZone, Timelike, Utc};
use omni_core::js::{self, JsValue};

use crate::num::{num, round};

const DAY: f64 = 86_400_000.0;
/// The largest time value a JavaScript `Date` holds.
const MAX_TIME: f64 = 8.64e15;

fn utc(ms: f64) -> Option<DateTime<Utc>> {
    Utc.timestamp_millis_opt(ms as i64).single()
}

/// The instant a local wall-clock time names. A time a clock change skipped reads with the offset from before the
/// change, and one that happens twice is its first: what `new Date(y, m, d, h)` and `Date.parse` do.
fn local_to_utc<Tz: TimeZone>(naive: NaiveDateTime, tz: &Tz) -> Option<f64> {
    let at = match tz.from_local_datetime(&naive) {
        LocalResult::Single(at) => at.timestamp_millis(),
        LocalResult::Ambiguous(first, _) => first.timestamp_millis(),
        LocalResult::None => {
            let before = tz.offset_from_utc_datetime(&(naive - Duration::days(2))).fix();
            (naive - Duration::seconds(i64::from(before.local_minus_utc()))).and_utc().timestamp_millis()
        }
    };
    Some(at as f64)
}

struct Scanner<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Scanner<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn eat(&mut self, byte: u8) -> bool {
        let hit = self.peek() == Some(byte);
        if hit {
            self.at += 1;
        }
        hit
    }

    /// Exactly `count` digits.
    fn digits(&mut self, count: usize) -> Option<i64> {
        let slice = self.bytes.get(self.at..self.at + count)?;
        if !slice.iter().all(u8::is_ascii_digit) {
            return None;
        }
        self.at += count;
        Some(slice.iter().fold(0, |n, b| n * 10 + i64::from(b - b'0')))
    }

    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

/// `Date.parse` for the forms Omni's API sends: the ISO format (`2026-11-16T10:30:00.000Z`, with or without seconds,
/// a fraction and an offset, and the date alone) and the same with a space for the `T`, which SQLite writes. A date
/// alone is UTC; a date and time with no offset is local time. Anything else is not a date, as far as this goes.
pub fn parse_date<Tz: TimeZone>(text: &str, tz: &Tz) -> Option<f64> {
    let mut s = Scanner { bytes: text.as_bytes(), at: 0 };
    let year = if s.eat(b'+') {
        s.digits(6)?
    } else if s.eat(b'-') {
        let year = s.digits(6)?;
        if year == 0 {
            return None;
        }
        -year
    } else {
        s.digits(4)?
    };
    let mut month = 1;
    let mut day = 1;
    if s.eat(b'-') {
        month = s.digits(2)?;
        if s.eat(b'-') {
            day = s.digits(2)?;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // A day past the month's end rolls into the next month, as V8 reads 2021-02-30.
    let date = NaiveDate::from_ymd_opt(i32::try_from(year).ok()?, month as u32, 1)?.checked_add_signed(Duration::days(day - 1))?;
    if s.done() {
        return in_range(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis() as f64);
    }
    if !s.eat(b'T') && !s.eat(b' ') {
        return None;
    }
    let hour = s.digits(2)?;
    if !s.eat(b':') {
        return None;
    }
    let minute = s.digits(2)?;
    let mut second = 0;
    let mut milli = 0;
    if s.eat(b':') {
        second = s.digits(2)?;
        if s.eat(b'.') {
            // Any number of digits; the ones past the third are dropped.
            let start = s.at;
            while s.peek().is_some_and(|b| b.is_ascii_digit()) {
                s.at += 1;
            }
            let digits = &s.bytes[start..s.at];
            if digits.is_empty() {
                return None;
            }
            for i in 0..3 {
                milli = milli * 10 + digits.get(i).map_or(0, |b| i64::from(b - b'0'));
            }
        }
    }
    if minute > 59 || second > 59 || hour > 24 || (hour == 24 && (minute, second, milli) != (0, 0, 0)) {
        return None;
    }
    let naive = date.and_hms_opt(0, 0, 0)? + Duration::milliseconds(((hour * 60 + minute) * 60 + second) * 1000 + milli);
    let at = if s.eat(b'Z') {
        naive.and_utc().timestamp_millis() as f64
    } else if matches!(s.peek(), Some(b'+' | b'-')) {
        let sign = if s.eat(b'-') { -1 } else { i64::from(s.eat(b'+')) };
        let hours = s.digits(2)?;
        s.eat(b':');
        let minutes = s.digits(2)?;
        if hours > 23 || minutes > 59 {
            return None;
        }
        (naive.and_utc().timestamp_millis() - sign * (hours * 60 + minutes) * 60_000) as f64
    } else {
        local_to_utc(naive, tz)?
    };
    if !s.done() {
        return None;
    }
    in_range(at)
}

fn in_range(ms: f64) -> Option<f64> {
    (ms.abs() <= MAX_TIME).then_some(ms)
}

/// Midnight at the start of the local day `ms` is in: `setHours(0, 0, 0, 0)`.
fn start_of_day<Tz: TimeZone>(ms: f64, tz: &Tz) -> Option<f64> {
    let local = utc(ms)?.with_timezone(tz);
    local_to_utc(local.date_naive().and_hms_opt(0, 0, 0)?, tz)
}

const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/// The short month names of en-GB as ICU prints them, September included.
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

/// How long ago `t` was, in the words the Web UI uses. `now` is also where "this year" comes from.
pub fn rel_time_at<Tz: TimeZone>(t: f64, now: f64, tz: &Tz) -> String {
    let diff = now - t;
    if diff < 45_000.0 {
        return "just now".to_string();
    }
    if diff < 3_600_000.0 {
        return format!("{}m ago", num(round(diff / 60_000.0).max(1.0)));
    }
    let (Some(today), Some(at), Some(current)) = (start_of_day(now, tz), utc(t), utc(now)) else {
        return String::new();
    };
    if t >= today {
        return format!("{}h ago", num(round(diff / 3_600_000.0)));
    }
    let d = at.with_timezone(tz);
    let clock = format!("{:02}:{:02}", d.hour(), d.minute());
    if t >= today - DAY {
        return format!("Yesterday {clock}");
    }
    if t >= today - 6.0 * DAY {
        return format!("{} {clock}", WEEKDAYS[d.weekday().num_days_from_monday() as usize]);
    }
    let date = format!("{} {}", d.day(), MONTHS[d.month0() as usize]);
    if d.year() == current.with_timezone(tz).year() { date } else { format!("{date} {}", d.year()) }
}

/// `relTime(iso, now)`: empty for a text that is not a date.
pub fn rel_time<Tz: TimeZone>(iso: &str, now: f64, tz: &Tz) -> String {
    parse_date(iso, tz).map_or_else(String::new, |t| rel_time_at(t, now, tz))
}

/// "45s", "12m", "1h 05m", "2d 03h": how long a run has gone. Empty for a bad time.
pub fn elapsed_short(ms: f64) -> String {
    if !ms.is_finite() {
        return String::new();
    }
    let s = (ms / 1000.0).floor().max(0.0);
    if s < 60.0 {
        return format!("{}s", num(s));
    }
    let m = (s / 60.0).floor();
    if m < 60.0 {
        return format!("{}m", num(m));
    }
    let h = (m / 60.0).floor();
    if h < 24.0 {
        return format!("{}h {:02}m", num(h), (m % 60.0) as u64);
    }
    format!("{}d {:02}h", num((h / 24.0).floor()), (h % 24.0) as u64)
}

fn text_of(value: Option<&JsValue>) -> Option<String> {
    value.and_then(JsValue::as_js_string).map(js::JsString::to_string_lossy)
}

/// The run's elapsed time while it runs, else `None`.
pub fn run_elapsed<Tz: TimeZone>(thread: &JsValue, now: f64, tz: &Tz) -> Option<String> {
    let started = text_of(thread.get("run_started_at")).filter(|s| !s.is_empty())?;
    parse_date(&started, tz).map(|at| elapsed_short(now - at))
}

fn machine_name(stop: &JsValue) -> String {
    let name = text_of(stop.get("name")).unwrap_or_default();
    let name = js::trim_str(&name);
    if name.is_empty() { "Unnamed machine".to_string() } else { name.to_string() }
}

/// Where a thread runs or last ran, and the machines before it: "Running on MacBook Air · before: omarchy (2h ago)".
/// `show` prints the branch on its own line, so this leaves it out.
pub fn ran_on_title<Tz: TimeZone>(thread: &JsValue, now: f64, tz: &Tz) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(ran_on) = thread.get("ran_on").filter(|r| r.is_truthy()) {
        let status = text_of(thread.get("status")).unwrap_or_default();
        let running = thread.get("run_started_at").is_some_and(JsValue::is_truthy) || status == "running";
        let verb = if running {
            "Running on"
        } else if status == "queued" {
            "Queued on"
        } else {
            "Last ran on"
        };
        parts.push(format!("{verb} {}", machine_name(ran_on)));
        let before = ran_on.get("before").and_then(JsValue::as_array).unwrap_or_default();
        if !before.is_empty() {
            let stops: Vec<String> = before
                .iter()
                .rev()
                .map(|stop| match text_of(stop.get("at")).filter(|at| !at.is_empty()) {
                    Some(at) => format!("{} ({})", machine_name(stop), rel_time(&at, now, tz)),
                    None => machine_name(stop),
                })
                .collect();
            parts.push(format!("before: {}", stops.join(", ")));
        }
    }
    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::Tz;

    const AMS: Tz = chrono_tz::Europe::Amsterdam;

    fn at(iso: &str) -> f64 {
        parse_date(iso, &Utc).unwrap()
    }

    #[test]
    fn parses_the_forms_the_api_sends() {
        assert_eq!(at("2026-11-16T10:30:00.000Z"), 1_794_825_000_000.0);
        assert_eq!(at("2026-11-16T10:30:00.123456Z"), 1_794_825_000_123.0);
        assert_eq!(at("2026-11-16T11:30+01:00"), 1_794_825_000_000.0);
        assert_eq!(at("2026-11-16"), 1_794_787_200_000.0);
        assert_eq!(at("2021-02-30"), at("2021-03-02"));
        assert_eq!(parse_date("2026-11-16 11:30:00", &AMS), Some(1_794_825_000_000.0));
        assert_eq!(parse_date("2026-11-16T11:30:00", &AMS), Some(1_794_825_000_000.0));
        for bad in ["", "soon", "2026-13-01", "2026-11-16T25:00:00Z", "2026-11-16T10:30:00Zx", "16 Nov 2026"] {
            assert_eq!(parse_date(bad, &Utc), None, "{bad}");
        }
    }

    #[test]
    fn reads_a_skipped_and_a_repeated_local_time() {
        // 02:30 on the last Sunday of March does not exist in Amsterdam: it reads as 03:30 summer time.
        assert_eq!(parse_date("2026-03-29T02:30:00", &AMS), Some(at("2026-03-29T01:30:00Z")));
        // 02:30 on the last Sunday of October happens twice: the first one, in summer time.
        assert_eq!(parse_date("2026-10-25T02:30:00", &AMS), Some(at("2026-10-25T00:30:00Z")));
    }

    #[test]
    fn says_how_long_ago() {
        let now = at("2026-11-16T14:00:00Z");
        let ago = |iso: &str| rel_time(iso, now, &AMS);
        assert_eq!(ago("2026-11-16T13:59:30Z"), "just now");
        assert_eq!(ago("2026-11-16T15:00:00Z"), "just now");
        assert_eq!(ago("2026-11-16T13:59:00Z"), "1m ago");
        assert_eq!(ago("2026-11-16T13:01:00Z"), "59m ago");
        assert_eq!(ago("2026-11-16T09:20:00Z"), "5h ago");
        assert_eq!(ago("2026-11-15T22:59:00Z"), "Yesterday 23:59");
        assert_eq!(ago("2026-11-11T08:05:00Z"), "Wed 09:05");
        assert_eq!(ago("2026-09-03T08:05:00Z"), "3 Sept");
        assert_eq!(ago("2020-01-01T10:30:00.000Z"), "1 Jan 2020");
        assert_eq!(ago("not a date"), "");
    }

    #[test]
    fn counts_a_run() {
        assert_eq!(elapsed_short(45_999.0), "45s");
        assert_eq!(elapsed_short(-5.0), "0s");
        assert_eq!(elapsed_short(12.0 * 60_000.0), "12m");
        assert_eq!(elapsed_short(65.0 * 60_000.0), "1h 05m");
        assert_eq!(elapsed_short(51.0 * 3_600_000.0), "2d 03h");
        assert_eq!(elapsed_short(f64::NAN), "");
    }
}
