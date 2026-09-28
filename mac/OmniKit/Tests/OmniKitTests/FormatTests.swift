import Foundation
import Testing
import OmniKit

// Expected values are what web/src/format.ts prints for the same input, run with TZ=Europe/Amsterdam.

private let amsterdam: Calendar = {
  var c = Calendar(identifier: .gregorian)
  c.timeZone = TimeZone(identifier: "Europe/Amsterdam")!
  return c
}()

private func at(_ text: String) -> Date { OmniJSON.parseDate(text)! }

private let now = at("2026-09-28T14:00:00+02:00")

@Suite struct FormatTests {
  @Test(arguments: [
    ("2026-09-28T13:59:50+02:00", "just now"),
    ("2026-09-28T13:59:16+02:00", "just now"),
    ("2026-09-28T13:59:15+02:00", "1m ago"),
    ("2026-09-28T13:58:31+02:00", "1m ago"),
    ("2026-09-28T13:58:30+02:00", "2m ago"),
    ("2026-09-28T13:00:20+02:00", "60m ago"),
    ("2026-09-28T11:00:00+02:00", "3h ago"),
    ("2026-09-28T00:10:00+02:00", "14h ago"),
    ("2026-09-27T23:30:00+02:00", "Yesterday 23:30"),
    ("2026-09-27T00:00:00+02:00", "Yesterday 00:00"),
    ("2026-09-24T09:05:00+02:00", "Thu 09:05"),
    ("2026-09-22T00:00:00+02:00", "Tue 00:00"),
    ("2026-09-21T23:59:00+02:00", "21 Sept"),
    ("2026-09-05T10:00:00+02:00", "5 Sept"),
    ("2025-12-31T10:00:00+01:00", "31 Dec 2025"),
    ("2026-09-28T14:05:00+02:00", "just now"),
  ])
  func saysHowLongAgo(_ time: String, _ want: String) {
    #expect(Format.relTime(at(time), now: now, calendar: amsterdam) == want)
  }

  @Test func namesEveryMonthAndWeekdayLikeTheWebUI() {
    let months = (1...12).map { m in
      Format.shortDate(amsterdam.date(from: DateComponents(year: 2026, month: m, day: 1, hour: 12))!, now: now, calendar: amsterdam)
    }
    #expect(months == ["1 Jan", "1 Feb", "1 Mar", "1 Apr", "1 May", "1 Jun", "1 Jul", "1 Aug", "1 Sept", "1 Oct", "1 Nov", "1 Dec"])
    let days = (22...27).map { d in
      Format.relTime(amsterdam.date(from: DateComponents(year: 2026, month: 9, day: d, hour: 8))!, now: now, calendar: amsterdam)
    }
    #expect(days == ["Tue 08:00", "Wed 08:00", "Thu 08:00", "Fri 08:00", "Sat 08:00", "Yesterday 08:00"])
  }

  @Test func tellsTheTimeOnATwentyFourHourClock() {
    #expect(Format.clock(at("2026-09-28T09:05:00+02:00"), calendar: amsterdam) == "09:05")
    #expect(Format.clock(at("2026-09-28T00:05:00+02:00"), calendar: amsterdam) == "00:05")
    #expect(Format.clock(at("2026-09-28T23:59:00+02:00"), calendar: amsterdam) == "23:59")
  }

  @Test(arguments: [
    (nil, ""), (0, "0s"), (499, "0s"), (500, "1s"), (59_499, "59s"), (59_500, "1m 0s"), (61_000, "1m 1s"),
    (3_599_000, "59m 59s"), (3_600_000, "1h 0m"), (7_384_000, "2h 3m"),
  ] as [(Double?, String)])
  func saysHowLongATurnTook(_ ms: Double?, _ want: String) {
    #expect(Format.duration(ms: ms) == want)
  }

  @Test(arguments: [
    (0, "0 B"), (1023, "1023 B"), (1024, "1.0 KB"), (1280, "1.3 KB"), (10_239, "10.0 KB"), (10_240, "10 KB"),
    (1_048_575, "1024 KB"), (1_048_576, "1.0 MB"), (5_505_024, "5.3 MB"), (1_153_434, "1.1 MB"),
  ])
  func sizesFiles(_ n: Int, _ want: String) {
    #expect(Format.bytes(n) == want)
  }

  @Test func countsWithTheRightWord() {
    #expect(Format.plural(1, "turn") == "1 turn")
    #expect(Format.plural(2, "turn") == "2 turns")
    #expect(Format.plural(0, "file") == "0 files")
    #expect(Format.plural(2, "child", "children") == "2 children")
  }

  @Test(arguments: [
    ("/Users/ben/code/omni/src/a.ts", "/Users/ben/code/omni", "src/a.ts"),
    ("/Users/ben/code/omni", "/Users/ben/code/omni", "~/code/omni"),
    ("/Users/ben/a/b/c/d.ts", nil, ".../b/c/d.ts"),
    ("/etc/hosts", nil, "/etc/hosts"),
    ("/usr/local/lib/node/x.js", nil, ".../lib/node/x.js"),
    ("a/b/c/d", nil, "a/b/c/d"),
    ("a/b/c/d/e", "", ".../c/d/e"),
    ("", nil, ""),
    ("/Users/ben/x", nil, "~/x"),
  ] as [(String, String?, String)])
  func shortensPaths(_ path: String, _ cwd: String?, _ want: String) {
    #expect(Format.shortPath(path, cwd: cwd) == want)
  }

  @Test(arguments: [
    (String(repeating: "a\n", count: 19) + "a", false),
    (String(repeating: "a\n", count: 20) + "a", true),
    (String(repeating: "x", count: 110 * 10) + "\n" + String(repeating: "x", count: 109 * 1), false),
    (String(repeating: "x", count: 110 * 20), true),
    ("", false),
  ])
  func aBoxScrollsPastTwentyLinesCountingWraps(text: String, tall: Bool) {
    #expect(Format.isTall(text) == tall)
  }

  @Test(arguments: [
    ("acme", AvatarMark(hue: 346, letter: "A")),
    ("-x1", AvatarMark(hue: (45 * 31 * 31 + 120 * 31 + 49) % 360, letter: "X")),
    ("😀", AvatarMark(hue: ((55357 % 360) * 31 + 56832) % 360, letter: "?")),
    ("", AvatarMark(hue: 0, letter: "?")),
  ])
  func anAvatarTakesItsHueAndLetterFromTheName(name: String, want: AvatarMark) {
    #expect(AvatarMark(name: name) == want)
  }
}
