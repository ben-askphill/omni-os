import Foundation
import Testing
import OmniKit

// The client half of packages/shared/history.ts. The corpus is written by packages/shared/tests/history.test.ts and
// read from the repo, so the two cannot drift.

private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private struct CursorJSON: Decodable {
  var take: String?
  var at: Int?
  var after: Int?
  var before: Int?

  var cursor: HistoryCursor {
    if let at { return .at(at, after: after, before: before) }
    if take == "oldest", let after { return .oldest(after: after, before: before) }
    return .newest(before: before, after: after)
  }
}

private enum Step: Decodable {
  case open([EventRow], HistoryHead)
  case head([EventRow], HistoryHead)
  case page(HistoryPage)
  case live([EventRow])
  case replace(EventRow)
  case detach
  case bound(follows: Bool, retain: History.Retain)

  enum CodingKeys: String, CodingKey { case op, events, head, page, rows, row, follows, retain }

  init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .op) {
    case "open": self = .open(try c.decode([EventRow].self, forKey: .events), try c.decode(HistoryHead.self, forKey: .head))
    case "head": self = .head(try c.decode([EventRow].self, forKey: .events), try c.decode(HistoryHead.self, forKey: .head))
    case "page": self = .page(try c.decode(HistoryPage.self, forKey: .page))
    case "live": self = .live(try c.decode([EventRow].self, forKey: .rows))
    case "replace": self = .replace(try c.decode(EventRow.self, forKey: .row))
    case "bound": self = .bound(follows: try c.decode(Bool.self, forKey: .follows), retain: try c.decode(History.Retain.self, forKey: .retain))
    default: self = .detach
    }
  }
}

private struct RevealJSON: Decodable {
  var id: Int
  var cursor: CursorJSON?
  var span: Int
}

private struct EdgeJSON: Decodable {
  var key: Int
  var edge: HistoryEdge

  private struct Body: Decodable {
    var type: String
    var after: Int?
  }

  init(from decoder: any Decoder) throws {
    var c = try decoder.unkeyedContainer()
    key = try c.decode(Int.self)
    let body = try c.decode(Body.self)
    edge = body.type == "earlier" ? .earlier : .gap(after: body.after ?? -1)
  }
}

private struct Expect: Decodable {
  var ids: [Int]
  var clipped: [Int]
  var spans: [HistorySpan]
  var atStart: Bool
  var tailId: Int
  var turnCount: Int
  var earlier: [CursorJSON?]
  var later: [CursorJSON?]
  var reveal: [RevealJSON]
  var edges: [EdgeJSON]
}

private struct Case: Decodable {
  var name: String
  var steps: [Step]
  var reveal: [Int]
  var keys: [Int]
  var expect: Expect
}

private struct Corpus: Decodable {
  var cases: [Case]
}

private func run(_ steps: [Step]) -> History {
  var h = History()
  for s in steps {
    switch s {
    case .open(let events, let head): h = History(open: events, head: head)
    case .head(let events, let head): h.apply(head: events, head)
    case .page(let page): h.apply(page)
    case .live(let rows): h.append(live: rows)
    case .replace(let row): h.replace(row)
    case .detach: h.detachHead()
    case .bound(let follows, let retain): h.bound(follows: follows, retain: retain)
    }
  }
  return h
}

private func rowJSON(_ id: Int, _ kind: String = "assistant_text", clipped: Bool = false) -> String {
  let clip = clipped ? #","clipped":{"bytes":90000}"# : ""
  let text = clipped ? "cut…" : "row \(id)"
  return #"{"id":\#(id),"thread_id":"t","kind":"\#(kind)","payload":"{\"text\":\"\#(text)\"}","created_at":"2026-10-24T10:00:00.000Z"\#(clip)}"#
}

private func row(_ id: Int, _ kind: String = "assistant_text", clipped: Bool = false) throws -> EventRow {
  try decode(EventRow.self, rowJSON(id, kind, clipped: clipped))
}

private func page(_ rows: [String], from: Int, to: Int?) throws -> HistoryPage {
  try decode(HistoryPage.self, #"{"events":[\#(rows.joined(separator: ","))],"span":{"from":\#(from),"to":\#(to.map(String.init) ?? "null")}}"#)
}

private func head(_ from: Int, below: Int = 0) throws -> HistoryHead {
  try decode(HistoryHead.self, #"{"from":\#(from),"to":null,"results_below":\#(below)}"#)
}

private func query(_ c: HistoryCursor?) -> String? {
  c.map { $0.query.map { "\($0.0)=\($0.1)" }.joined(separator: "&") }
}

@Suite struct HistoryTests {
  @Test func replaysTheSharedCorpus() throws {
    let url = repoRoot.appending(path: "packages/test-fixtures/history/spans.json")
    let corpus = try OmniJSON.decoder().decode(Corpus.self, from: Data(contentsOf: url))
    #expect(corpus.cases.count >= 10)
    for k in corpus.cases {
      let h = run(k.steps)
      let x = k.expect
      #expect(h.rows.map(\.id) == x.ids, "\(k.name) ids")
      #expect(h.rows.filter { $0.clipped != nil }.map(\.id) == x.clipped, "\(k.name) clipped")
      #expect(h.spans == x.spans, "\(k.name) spans")
      #expect(h.atStart == x.atStart, "\(k.name) atStart")
      #expect(h.tailID == x.tailId, "\(k.name) tailID")
      #expect(h.turnCount == x.turnCount, "\(k.name) turnCount")
      #expect(h.spans.indices.map { h.earlier($0) } == x.earlier.map { $0?.cursor }, "\(k.name) earlier")
      #expect(h.spans.indices.map { h.later($0) } == x.later.map { $0?.cursor }, "\(k.name) later")
      for r in x.reveal {
        #expect(h.reveal(r.id) == r.cursor?.cursor, "\(k.name) reveal \(r.id)")
        #expect((h.spanIndex(r.id) ?? -1) == r.span, "\(k.name) span of \(r.id)")
      }
      #expect(h.edges(k.keys) == Dictionary(uniqueKeysWithValues: x.edges.map { ($0.key, $0.edge) }), "\(k.name) edges")
      let ids = h.rows.map(\.id)
      #expect(ids == Array(Set(ids)).sorted(), "\(k.name) rows ascending, each once")
      for i in h.spans.indices.dropFirst() { #expect(h.spans[i - 1].to! < h.spans[i].from, "\(k.name) spans apart") }
      #expect(h.spans.last?.to == nil, "\(k.name) reaches the live end")
    }
  }

  @Test func writesCursorsAsHistoryQueryDoes() {
    #expect(query(.newest()) == "")
    #expect(query(.newest(before: 9, after: 2)) == "after=2&before=9")
    #expect(query(.oldest(after: 3, before: 7)) == "take=oldest&after=3&before=7")
    #expect(query(.at(5, after: 1)) == "at=5&after=1")
  }

  @Test func joinsInAnyOrderAndAnyNumberOfTimes() throws {
    let start = History(open: [try row(40), try row(41)], head: try head(40))
    let a = try page([rowJSON(10), rowJSON(11)], from: 10, to: 20)
    let b = try page([rowJSON(20), rowJSON(25)], from: 20, to: 30)
    let c = try page([rowJSON(5), rowJSON(11, clipped: true)], from: 5, to: 10)
    let pages = [a, b, c]
    var results: [History] = []
    for order in [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1], [0, 0, 1, 2, 2]] {
      var h = start
      for i in order { h.apply(pages[i]) }
      results.append(h)
    }
    for r in results { #expect(r == results[0]) }
    #expect(results[0].spans == [HistorySpan(from: 5, to: 30), HistorySpan(from: 40, to: nil)])
    #expect(results[0].rows.first { $0.id == 11 }?.clipped == nil, "the whole copy wins")
  }

  @Test func appendsLiveRowsOnceAndReportsWhetherAnyWasNew() throws {
    var h = History(open: [try row(40), try row(42)], head: try head(40))
    let same = h.append(live: [try row(40), try row(42)])
    #expect(!same)
    let fresh = h.append(live: [try row(44), try row(41), try row(43)])
    #expect(fresh)
    #expect(h.rows.map(\.id) == [40, 41, 42, 43, 44])
    #expect(h.tailID == 44)
  }

  @Test func replacesAClippedRowWithTheWholeOne() throws {
    var h = History(open: [try row(40, clipped: true), try row(41)], head: try head(40))
    let replaced = h.replace(try row(40))
    #expect(replaced)
    #expect(h.rows.map { $0.clipped == nil } == [true, true])
    let unknown = h.replace(try row(7))
    #expect(!unknown, "a row not held changes nothing")
  }

  /// The recorded fixtures, joined as the app does: open on the head, an earlier page, then a reveal of the first
  /// message, whose clipped copy then loads whole.
  @Test func joinsTheRecordedPages() throws {
    let open = try decodeFixture(ThreadDetail.self, "thread-open.json")
    let head = try #require(open.history)
    var h = History(open: open.events, head: head)
    #expect(!h.atStart)
    #expect(h.spans == [HistorySpan(from: head.from, to: nil)])
    #expect(h.earlier() == .newest(before: head.from))

    let earlier = try decodeFixture(HistoryPage.self, "thread-history.json")
    #expect(earlier.span.to == head.from)
    h.apply(earlier)
    #expect(h.spans == [HistorySpan(from: earlier.span.from, to: nil)])

    let whole = try decodeFixture(EventRow.self, "thread-event.json")
    let first = whole.id
    #expect(h.reveal(first) == .at(first, before: earlier.span.from))
    let at = try decodeFixture(HistoryPage.self, "thread-history-at.json")
    #expect(at.events.contains { $0.id == first })
    h.apply(at)
    #expect(h.reveal(first) == nil)
    #expect(h.spanIndex(first) != nil)

    #expect(h.rows.first { $0.id == whole.id }?.clipped != nil)
    #expect(whole.clipped == nil)
    let replaced = h.replace(whole)
    #expect(replaced)
    #expect(h.rows.first { $0.id == whole.id }?.payload == whole.payload)
    #expect(h.turnCount == head.resultsBelow + h.rows.count { $0.kind == "result" && $0.id >= head.from })
  }

  @Test func readsSearchHitsWithTheirEvent() throws {
    let hits = try decodeFixture([SearchHit].self, "search.json")
    #expect(hits.contains { $0.eventID != nil && !$0.snippet.isEmpty })
    #expect(hits.compactMap(\.eventID).allSatisfy { $0 > 0 })
  }
}
