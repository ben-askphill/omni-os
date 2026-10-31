#if DEBUG
import AppKit
import OmniKit
import SwiftUI
import WebKit

/// The QA scroll steps and the earlier-page check.
extension QARunner {

  func scroll(_ scroll: QAScroll) async throws(QAScriptError) -> String? {
    guard let scroller = QAProbe.scroller else { throw QAScriptError("no thread on screen") }
    switch scroll {
    case .top:
      scroller.toTop()
    case .bottom:
      scroller.toBottom()
    case .through:
      guard let view = Self.windows.first(where: Self.isMain)?.contentView else { throw QAScriptError("no main window") }
      scroller.toBottom()
      try? await Task.sleep(for: .seconds(1))
      let gaps = await FrameClock().run(in: view, frames: 5000, scroller.pageUp)
      return QAFrameStats(gaps: gaps).summary
    case .nudge:
      guard let window = Self.windows.first(where: Self.isMain), let content = window.contentView,
        let transcript = Self.scrollViews(in: content).max(by: { $0.frame.width < $1.frame.width })
      else { throw QAScriptError("no transcript scroll view") }
      scroller.toBottom()
      try? await Task.sleep(for: .seconds(1))
      // A short trackpad swipe up: began, a few changes, ended, as in Ben's recording.
      let phases: [CGScrollPhase] = [.began, .changed, .changed, .changed, .ended]
      for phase in phases {
        guard let cg = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: phase == .ended ? 0 : 12, wheel2: 0, wheel3: 0)
        else { throw QAScriptError("can't make a scroll event") }
        cg.setIntegerValueField(.scrollWheelEventScrollPhase, value: Int64(phase.rawValue))
        cg.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        guard let event = NSEvent(cgEvent: cg) else { throw QAScriptError("can't make a scroll event") }
        transcript.scrollWheel(with: event)
        try? await Task.sleep(for: .milliseconds(16))
      }
      try? await Task.sleep(for: .milliseconds(300))
      let soon = scroller.distanceFromBottom() ?? -1
      // Then content that grows with no scroll, as a lazy row measured late: the tool groups open.
      QAProbe.expand?()
      try? await Task.sleep(for: .milliseconds(1500))
      let later = scroller.distanceFromBottom() ?? -1
      return "from the bottom \(Int(soon.rounded())) pt after the swipe, \(Int(later.rounded())) pt once the content grew"
    case .earlier:
      return try await earlierPage()
    case .gap:
      guard let store = QAProbe.store, store.history.spans.count > 1 else { throw QAScriptError("no gap in the open thread") }
      let keys = store.transcript.items.compactMap { if case .event(let k) = $0.id { k } else { nil } }
      guard let key = store.history.edges(keys).first(where: { if case .gap = $0.value { true } else { false } })?.key, key >= 0
      else { throw QAScriptError("no shown row under the gap") }
      scroller.toItem(.event(key))
    }
    try? await Task.sleep(for: .milliseconds(600))
    return nil
  }

  /// Scrolls up with trackpad events, as Ben would, until "Earlier messages" starts a page by itself, takes the row at
  /// the top of the view right then (the page cannot have landed: it is still on the network), and again once the
  /// page is laid out. The reading position holds when the same row sits at the same height.
  func earlierPage() async throws(QAScriptError) -> String {
    guard let store = QAProbe.store else { throw QAScriptError("no thread on screen") }
    guard let window = Self.windows.first(where: Self.isMain), let content = window.contentView,
      let transcript = Self.scrollViews(in: content).max(by: { $0.frame.width < $1.frame.width })
    else { throw QAScriptError("no transcript scroll view") }
    guard let from = store.history.spans.first?.from, from > 0 else { throw QAScriptError("the whole thread is loaded") }
    func wheel(_ phase: CGScrollPhase, _ dy: Int32) throws(QAScriptError) {
      guard let cg = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)
      else { throw QAScriptError("can't make a scroll event") }
      cg.setIntegerValueField(.scrollWheelEventScrollPhase, value: Int64(phase.rawValue))
      cg.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
      guard let event = NSEvent(cgEvent: cg) else { throw QAScriptError("can't make a scroll event") }
      transcript.scrollWheel(with: event)
    }
    func top() -> (id: TranscriptItemID, minY: Double)? { QAProbe.rows?.anchor.map { ($0.id, $0.frame.minY) } }
    var before: (id: TranscriptItemID, minY: Double)?
    let deadline = ContinuousClock.now + .seconds(30)
    try wheel(.began, 0)
    while !store.loadingEdges.contains(.earlier) {
      guard ContinuousClock.now < deadline else { throw QAScriptError("no earlier page started") }
      before = top()
      try wheel(.changed, 40)
      try? await Task.sleep(for: .milliseconds(8))
    }
    try wheel(.ended, 0)
    before = top() ?? before
    while store.loadingEdges.contains(.earlier) {
      guard ContinuousClock.now < deadline else { throw QAScriptError("the earlier page did not land") }
      try? await Task.sleep(for: .milliseconds(5))
    }
    try? await Task.sleep(for: .milliseconds(800))
    let held = store.history.spans.first?.from ?? 0
    guard let before else { return "no row on screen before the page; held from \(from) to \(held)" }
    let id = if case .event(let k) = before.id { "\(k)" } else { "plan" }
    guard let now = QAProbe.rows?.frames[before.id]?.minY else {
      return "row \(id) at \(Int(before.minY.rounded())) pt before, off screen after: moved; held from \(from) to \(held)"
    }
    let verdict = abs(now - before.minY) < 1 ? "held" : "moved \(Int((now - before.minY).rounded())) pt"
    return "row \(id) at \(Int(before.minY.rounded())) pt before, \(Int(now.rounded())) pt after: \(verdict); held from \(from) to \(held)"
  }

  /// Waits for the thread a search hit opened to show the hit's row in view, and says where.
  func revealed(_ hit: SearchHit) async throws(QAScriptError) -> String {
    guard let at = hit.eventID else { return "a title hit: the thread opens at the bottom" }
    return try await revealed(thread: hit.threadID, at: at)
  }

  /// Waits for the open thread to show the row holding an event in view, and says where.
  func revealed(thread: String, at: Int) async throws(QAScriptError) -> String {
    let deadline = ContinuousClock.now + .seconds(15)
    while ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(100))
      guard let store = QAProbe.store, store.id == thread, store.revealTarget == nil, store.history.spanIndex(at) != nil,
        let id = store.transcript.itemID(holding: at), let frame = QAProbe.rows?.frames[id],
        let height = QAProbe.scroller?.viewportHeight(), frame.minY < height, frame.maxY > 0
      else { continue }
      try? await Task.sleep(for: .milliseconds(400))
      let key = if case .event(let k) = id { "\(k)" } else { "plan" }
      return "event \(at) in row \(key) at \(Int(frame.minY.rounded())) pt of \(Int(height.rounded())); held from \(store.history.spans.map { "\($0.from)" }.joined(separator: ", "))"
    }
    throw QAScriptError("event \(at) never showed")
  }
}
#endif
