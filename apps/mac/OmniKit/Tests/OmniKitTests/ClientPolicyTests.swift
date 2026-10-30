import Foundation
import Testing
@testable import OmniKit

// The client policies the Mac app and the Web UI both implement, held to one corpus each in
// packages/test-fixtures/policies/. apps/web/tests/client-policies.test.ts reads the same files, so the two ports
// cannot drift. A case that fails here and not there (or the reverse) is a real difference.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private func corpusData(_ name: String) throws -> Data {
  try Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/policies/\(name).json"))
}

private func corpus<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
  try OmniJSON.decoder().decode(T.self, from: corpusData(name))
}

// MARK: - Continue eligibility

private struct ContinueCorpus: Decodable {
  struct Refusal: Decodable {
    let harness: String
    let target: String?
    let source: String?
  }
  struct Initial: Decodable, Equatable {
    let harness: String
    let model: String
  }
  struct Targets: Decodable {
    let `case`: String
    let source: String
    let unavailable: [String]
    let offered: [String]
    let refused: [String]
    let initial: Initial?
  }
  struct SlashHint: Decodable {
    let text: String
    let hint: String?
  }
  struct Size: Decodable {
    let chars: Int
    let budget: Int
    let text: String
  }
  struct Carried: Decodable {
    let stats: CarriedStats
    let text: String
  }
  struct Entry: Decodable {
    let who: String
    let text: String
    let shown: String
  }
  let refusals: [Refusal]
  let targets: [Targets]
  let slashHints: [SlashHint]
  let sizes: [Size]
  let carried: [Carried]
  let entries: [Entry]
}

/// The corpus's catalog with the case's harnesses not ready, decoded as GET /api/status gives it.
private func catalog(unavailable: [String]) throws -> [HarnessInfo] {
  guard let root = try JSONSerialization.jsonObject(with: corpusData("continue")) as? [String: Any],
    let list = root["catalog"] as? [[String: Any]]
  else { throw CocoaError(.coderReadCorrupt) }
  let harnesses = list.map { h -> [String: Any] in
    var h = h
    if let id = h["id"] as? String, unavailable.contains(id) { h["available"] = false }
    return h
  }
  return try OmniJSON.decoder().decode([HarnessInfo].self, from: JSONSerialization.data(withJSONObject: harnesses))
}

@Suite struct ContinuePolicyCorpusTests {
  @Test func refusesTheRemoteHarnesses() throws {
    for r in try corpus(ContinueCorpus.self, "continue").refusals {
      #expect(ContinueRules.continueRefusal(HarnessID(rawValue: r.harness)) == r.target, "\(r.harness)")
      #expect(ContinueRules.sourceRefusal(HarnessID(rawValue: r.harness)) == r.source, "\(r.harness)")
    }
  }

  @Test func offersTheLocalHarnessesAndPicksTheRunItOpensOn() throws {
    for t in try corpus(ContinueCorpus.self, "continue").targets {
      let targets = ContinueTargets(try catalog(unavailable: t.unavailable), source: HarnessID(rawValue: t.source))
      #expect(targets.offered.map(\.id.rawValue) == t.offered, "\(t.case)")
      #expect(targets.refused.map(\.id.rawValue) == t.refused, "\(t.case)")
      #expect(targets.initial.map { ContinueCorpus.Initial(harness: $0.harness.rawValue, model: $0.model) } == t.initial, "\(t.case)")
    }
  }

  @Test func writesTheSheetsLines() throws {
    let c = try corpus(ContinueCorpus.self, "continue")
    for s in c.slashHints { #expect(ContinueRules.slashHint(s.text) == s.hint, "\(s.text)") }
    for s in c.sizes { #expect(ContinueRules.sizeText(chars: s.chars, budget: s.budget) == s.text) }
    for s in c.carried { #expect(ContinueRules.carriedText(s.stats) == s.text) }
    for e in c.entries {
      let object: [String: Any] = ["id": 1, "who": e.who, "text": e.text, "condensed": false]
      let entry = try OmniJSON.decoder().decode(CarryoverEntry.self, from: JSONSerialization.data(withJSONObject: object))
      #expect(ContinueRules.entryText(entry) == e.shown, "\(e.text)")
    }
  }
}

// MARK: - Handoff display

private struct HandoffCorpus: Decodable {
  struct Banner: Decodable, Equatable {
    let size: String
    let tone: String
    let cancel: Bool?
  }
  struct ViewCase: Decodable {
    let `case`: String
    let view: HandoffView
    let status: String
    let text: String
    let banner: Banner?
  }
  struct Confirm: Decodable {
    let title: String
    let body: String
  }
  struct TakeoverCase: Decodable {
    let takeover: Takeover
    let note: String
    let confirm: Confirm
  }
  struct Row: Decodable, Equatable {
    let id: String
    let pickable: Bool
    let label: String
  }
  struct DevicesCase: Decodable {
    let `case`: String
    let devices: [Device]
    let rows: [Row]
  }
  let views: [ViewCase]
  let takeovers: [TakeoverCase]
  let devices: [DevicesCase]
}

private func tone(_ t: HandoffBanner.Tone) -> String {
  switch t {
  case .working: "working"
  case .waiting: "waiting"
  case .alert: "alert"
  case .done: "done"
  case .cancelled: "cancelled"
  }
}

@Suite struct HandoffPolicyCorpusTests {
  @Test func writesTheBannerPerPhase() throws {
    for v in try corpus(HandoffCorpus.self, "handoff").views {
      #expect(v.view.text(now: v.view.at) == v.text, "\(v.case)")
      let banner = HandoffBanner(v.view, status: ThreadStatus(rawValue: v.status), now: v.view.at)
      let shown: HandoffCorpus.Banner? =
        switch banner {
        case .card(let t, _, let cancel)?: HandoffCorpus.Banner(size: "card", tone: tone(t), cancel: cancel)
        case .line(let t, _)?: HandoffCorpus.Banner(size: "line", tone: tone(t), cancel: nil)
        case nil: nil
        }
      #expect(shown == v.banner, "\(v.case)")
    }
  }

  @Test func writesTheTakeoverNoteAndConfirm() throws {
    for t in try corpus(HandoffCorpus.self, "handoff").takeovers {
      #expect(t.takeover.note == t.note)
      #expect(t.takeover.confirm.title == t.confirm.title)
      #expect(t.takeover.confirm.body == t.confirm.body)
    }
  }

  @Test func ordersAndLabelsThePicker() throws {
    for d in try corpus(HandoffCorpus.self, "handoff").devices {
      let rows = Device.picker(d.devices).map { HandoffCorpus.Row(id: $0.id, pickable: $0.canTake, label: $0.reachabilityLabel()) }
      #expect(rows == d.rows, "\(d.case)")
    }
  }
}

// MARK: - Run-location defaults

private struct RunOnCorpus: Decodable {
  struct Default: Decodable {
    let `case`: String
    let listed: [String]
    let saved: String
    let pick: String
  }
  struct Hold: Decodable {
    let `case`: String
    let listed: [String]
    let picked: String?
    let saved: String
    let pick: String
  }
  struct Sent: Decodable {
    let `case`: String
    let listed: [String]
    let pick: String
    let device: String?
  }
  struct Label: Decodable {
    let listed: [String]
    let pick: String
    let label: String
  }
  let devices: [Device]
  let defaults: [Default]
  let holds: [Hold]
  let sent: [Sent]
  let labels: [Label]

  func listed(_ ids: [String]) -> [Device] { devices.filter { ids.contains($0.id) } }
}

@Suite struct RunOnPolicyCorpusTests {
  @Test func startsOnTheDefault() throws {
    let r = try corpus(RunOnCorpus.self, "run-on")
    for c in r.defaults { #expect(RunOnRules.resolved(c.saved, devices: r.listed(c.listed)) == c.pick, "\(c.case)") }
  }

  @Test func keepsAPickWhileItHolds() throws {
    let r = try corpus(RunOnCorpus.self, "run-on")
    for c in r.holds { #expect(RunOnRules.held(c.picked, saved: c.saved, devices: r.listed(c.listed)) == c.pick, "\(c.case)") }
  }

  @Test func sendsTheDevice() throws {
    let r = try corpus(RunOnCorpus.self, "run-on")
    for c in r.sent { #expect(RunOnRules.sent(c.pick, devices: r.listed(c.listed)) == c.device, "\(c.case)") }
  }

  @Test func namesThePick() throws {
    let r = try corpus(RunOnCorpus.self, "run-on")
    for c in r.labels { #expect(RunOnRules.label(c.pick, devices: r.listed(c.listed)) == c.label) }
  }
}
