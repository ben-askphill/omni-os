import Foundation
import Testing
import OmniKit

// A limit stop's card (Limits.swift), with the Web UI's rules (apps/web/src/limits.ts, tested by apps/web/tests/web-limits.test.ts).
// The recorded answers are read in FixtureTests.

private var amsterdam: Calendar {
  var c = Calendar(identifier: .gregorian)
  c.timeZone = TimeZone(identifier: "Europe/Amsterdam")!
  return c
}

/// 5 Jan 2026 at h:m in Amsterdam, `days` later.
private func at(_ h: Int, _ m: Int = 0, days: Int = 0) -> Date {
  amsterdam.date(from: DateComponents(year: 2026, month: 1, day: 5 + days, hour: h, minute: m))!
}

@Suite struct LimitsTests {
  let now = at(14)

  @Test func offersResumeAtResetOnlyWithAResetTime() {
    let limited = LimitStop.view(limit: .limited, resetsAt: at(17), harness: "Claude Code", now: now, calendar: amsterdam)
    #expect(limited == LimitStop.View(
      title: "Usage limit reached", body: "Claude Code stopped this turn at your plan's limit. It resets at 17:00.", actions: [.schedule, .resume]))
    #expect(LimitStop.view(limit: .limited, resetsAt: nil, harness: "Codex", now: now, calendar: amsterdam)?.actions == [.resume])
    let scheduled = LimitStop.view(limit: .scheduled, resetsAt: at(9, 30, days: 1), harness: "Codex", now: now, calendar: amsterdam)
    #expect(scheduled?.title == "Resumes at tomorrow 09:30")
    #expect(scheduled?.actions == [.cancel, .resume])
    #expect(LimitStop.view(limit: nil, resetsAt: at(17), harness: "Codex", now: now, calendar: amsterdam) == nil)
  }

  @Test func showsTheOtherMacsStopWithNothingToPress() {
    let limited = LimitStop.view(limit: .limited, resetsAt: at(17), elsewhere: true, harness: "Claude Code", now: now, calendar: amsterdam)
    #expect(limited == LimitStop.View(
      title: "Usage limit reached on your other Mac",
      body: "Claude Code stopped this turn at your plan's limit on your other Mac. It resets at 17:00. Resume it there.",
      actions: []))
    let scheduled = LimitStop.view(limit: .scheduled, resetsAt: at(9, 30, days: 1), elsewhere: true, harness: "Codex", now: now, calendar: amsterdam)
    #expect(scheduled?.title == "Resumes at tomorrow 09:30 on your other Mac")
    #expect(scheduled?.actions == [])
  }

  @Test func namesTheResetByTimeTomorrowOrWeekday() {
    #expect(LimitStop.resetLabel(at(17, 5), now: now, calendar: amsterdam) == "17:05")
    #expect(LimitStop.resetLabel(at(8, days: 1), now: now, calendar: amsterdam) == "tomorrow 08:00")
    // 9 Jan 2026 is a Friday.
    #expect(LimitStop.resetLabel(at(8, days: 4), now: now, calendar: amsterdam) == "Fri 08:00")
  }

  @Test func labelsItsActions() {
    #expect([LimitStop.Action.schedule, .cancel, .resume].map(\.label) == ["Resume at reset", "Cancel", "Resume now"])
    #expect(LimitStop.Action.resume.rawValue == "resume")
  }
}
