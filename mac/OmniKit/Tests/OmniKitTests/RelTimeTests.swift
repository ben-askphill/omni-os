import Foundation
import Testing
import OmniKit

/// `relTime` in web/src/format.ts.
@Suite struct RelTimeTests {
  private let utc = TimeZone(identifier: "UTC")!
  private let now = OmniJSON.parseDate("2026-09-28T12:00:00Z")!

  private func label(_ iso: String, in zone: TimeZone? = nil) -> String {
    RelTime.label(OmniJSON.parseDate(iso)!, now: now, timeZone: zone ?? utc)
  }

  @Test func saysJustNowUnder45Seconds() {
    #expect(label("2026-09-28T11:59:50Z") == "just now")
    #expect(label("2026-09-28T11:59:15.5Z") == "just now")
    #expect(label("2026-09-28T12:05:00Z") == "just now", "a clock ahead of ours")
  }

  @Test func countsMinutesUnderAnHour() {
    #expect(label("2026-09-28T11:59:15Z") == "1m ago")
    #expect(label("2026-09-28T11:55:00Z") == "5m ago")
    #expect(label("2026-09-28T11:00:30Z") == "60m ago", "59.5 minutes rounds up")
  }

  @Test func countsHoursToday() {
    #expect(label("2026-09-28T10:59:00Z") == "1h ago")
    #expect(label("2026-09-28T00:10:00Z") == "12h ago")
  }

  @Test func namesTheDayThisWeek() {
    #expect(label("2026-09-27T20:15:00Z") == "Yesterday 20:15")
    #expect(label("2026-09-25T08:05:00Z") == "Fri 08:05")
    #expect(label("2026-09-22T00:00:00Z") == "Tue 00:00")
  }

  @Test func givesTheDateBeforeThat() {
    // The Mac's en_GB says "Sep" where Node's says "Sept".
    #expect(label("2026-09-21T23:59:00Z") == "21 Sep")
    #expect(label("2026-01-05T09:00:00Z") == "5 Jan")
    #expect(label("2025-12-31T09:00:00Z") == "31 Dec 2025")
  }

  @Test func countsDaysInTheLocalZone() {
    let amsterdam = TimeZone(identifier: "Europe/Amsterdam")!
    // 22:30 UTC on the 27th is 00:30 on the 28th in Amsterdam: today there. 13.5 hours rounds up, as in JS.
    #expect(label("2026-09-27T22:30:00Z", in: amsterdam) == "14h ago")
    #expect(label("2026-09-27T21:30:00Z", in: amsterdam) == "Yesterday 23:30")
  }
}
