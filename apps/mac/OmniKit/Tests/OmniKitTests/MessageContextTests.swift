import Foundation
import Testing
@testable import OmniKit

// packages/test-fixtures/message-context.json is shared with packages/shared/tests/message-context.test.ts and the web
// tests, so the readers and the line picker cannot drift.
private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

/// The kinds these tests read with: every kind OmniKit has. The app's list is in apps/mac/Omni/ContextViews.swift.
private let kinds: [any MessageContextKind.Type] = [DiffSelectionContext.self, TerminalExcerptContext.self, BrowserAnnotationContext.self, ThreadReferenceContext.self]

private func corpus() throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/message-context.json")))
}

private func cases(_ key: String) throws -> [JSONValue] {
  guard case .array(let list)? = try corpus()[key] else { return [] }
  return list
}

private func int(_ v: JSONValue?) -> Int? {
  if case .number(let n)? = v { Int(exactly: n) } else { nil }
}

private func lines(_ file: JSONValue) -> [String] {
  guard case .array(let list)? = file["lines"] else { return [] }
  return list.compactMap { $0["text"]?.stringValue }
}

private func strings(_ v: JSONValue?) -> [String] {
  guard case .array(let list)? = v else { return [] }
  return list.compactMap(\.stringValue)
}

private let cart = """
  {"id":"r1","kind":"diff_selection","v":1,"label":"src/cart.ts:1-3","note":"names","body":{"path":"src/cart.ts","old_path":null,
   "side":"new","start":1,"end":3,"rows":[{"kind":"context","text":"a","old":1,"new":1},{"kind":"add","text":"b","old":null,"new":2},
   {"kind":"context","text":"c","old":2,"new":3}],"source":{"group":"unstaged","from":"9f2c1e4","to":"3f2a1c9","turn":null,
   "blob_old":"fa9fb2e","blob_new":"a31fcc1"}}}
  """

private let removedInATurn = """
  {"path":"src/cart.ts","old_path":null,"rows":[{"kind":"del","text":"b","old":2,"new":null}],
   "source":{"group":"turn","from":"1111111aaaa","to":"2222222bbbb","turn":"turn-1","blob_old":"fa9fb2e","blob_new":null}}
  """

private func parsed(_ json: String) throws -> DiffSelectionContext.Body {
  let value = try decode(JSONValue.self, json)
  return try #require(DiffSelectionContext.parse(value["body"] ?? value, v: 1))
}

@Suite struct MessageContextTests {
  @Test func everyCorpusKindIsRegisteredAndHasAKnownRecord() throws {
    let names = strings(try corpus()["kinds"])
    #expect(Set(names) == Set(kinds.map { $0.kind }))
    let records = try cases("records")
    for name in names {
      #expect(records.contains { $0["raw"]?["kind"]?.stringValue == name && $0["expect"]?["as"]?.stringValue == "known" }, "\(name)")
    }
  }

  @Test func readsEveryCorpusRecord() throws {
    let records = try cases("records")
    #expect(!records.isEmpty)
    for c in records {
      let name = c["name"]?.stringValue ?? "?"
      let expect = try #require(c["expect"])
      let reading = try #require(ContextReading.read(MessageContextList([c["raw"] ?? .null]), kinds: kinds).first)
      let why: String? = if case .fallback(_, let why) = reading { why.rawValue } else { nil }
      let r = reading.record
      #expect((reading.isKnown ? "known" : "fallback") == expect["as"]?.stringValue, "\(name)")
      #expect(why == expect["why"]?.stringValue, "\(name)")
      #expect(r.id == expect["id"]?.stringValue, "\(name)")
      #expect(r.label == expect["label"]?.stringValue, "\(name)")
      #expect(r.note == expect["note"]?.stringValue, "\(name)")
    }
  }

  @Test func readsANonListAsNoRecordsAndNumbersFallbackIDsByPosition() throws {
    for raw in ["null", "42", #""x""#, "{}", #"{"0": \#(cart)}"#] {
      #expect(try decode(MessageContextList.self, raw).isEmpty, "\(raw)")
    }
    let list = try decode(MessageContextList.self, #"[\#(cart), "x", null]"#)
    #expect(ContextReading.read(list, kinds: kinds).map(\.record.id) == ["r1", "context-1", "context-2"])
    #expect(ContextReading.read(list, kinds: kinds).map(\.isKnown) == [true, false, false])
  }

  @Test func neverFailsOnGarbage() throws {
    let bad = [
      #"[null, 1, {}, [], "x", true]"#,
      #"[{"kind": "diff_selection", "v": 1, "body": null}]"#,
      #"[{"kind": "diff_selection", "v": 1, "body": []}]"#,
      #"[{"kind": "diff_selection", "v": 1, "body": {"path": 42, "rows": "x", "source": []}}]"#,
      #"[{"kind": "diff_selection", "v": 1, "body": {"path": "a", "rows": [null, 1, "x", [], {"kind": "add", "text": 1}], "source": {}}}]"#,
      #"[{"kind": "diff_selection", "v": 1, "body": {"path": "a", "rows": [{"kind": "add", "text": "x", "new": 1}], "source": {"group": "turn", "from": {}, "to": []}}}]"#,
      #"[{"kind": "diff_selection", "v": -1, "body": {}}, {"kind": "diff_selection", "v": 1.5, "body": {}}, {"kind": "diff_selection", "v": 1e300}]"#,
      #"[{"kind": "constructor", "v": 1}, {"kind": "__proto__", "v": 1}, {"kind": "hasOwnProperty", "v": 1}]"#,
    ]
    for raw in bad {
      let read = ContextReading.read(try decode(MessageContextList.self, raw), kinds: kinds)
      #expect(!read.isEmpty && read.allSatisfy { !$0.isKnown }, "\(raw)")
    }
  }

  @Test func picksEveryCorpusSelection() throws {
    let selections = try cases("selections")
    #expect(!selections.isEmpty)
    for c in selections { try pick(c) }
  }

  private func pick(_ c: JSONValue) throws {
    let name = c["name"]?.stringValue ?? "?"
    let f = try #require(c["file"])
    let path = try #require(f["path"]?.stringValue)
    let diff = FileDiff(path: path, header: strings(f["header"]), lines: lines(f), add: 0, del: 0, binary: false)
    // The corpus numbers its lines as apps/web/src/diff.ts does; FileDiff must agree.
    if case .array(let want)? = f["lines"] {
      #expect(diff.rows.map { [$0.old, $0.new] } == want.map { [int($0["old"]), int($0["new"])] }, "\(name)")
    }
    let s = try #require(c["source"])
    let source = DiffSelectionContext.Source(
      group: try #require(s["group"]?.stringValue.flatMap(DiffSelectionContext.Group.init(rawValue:))),
      from: try #require(s["from"]?.stringValue), to: try #require(s["to"]?.stringValue), turn: s["turn"]?.stringValue)
    let got = DiffSelectionContext.select(
      file: diff, path: path, oldPath: f["old_path"]?.stringValue, from: try #require(int(c["from"])), to: try #require(int(c["to"])),
      source: source)
    let expect = try #require(c["expect"])
    switch got {
    case .failure(let e):
      #expect(expect["error"]?.stringValue == e.message, "\(name)")
    case .success(let body):
      #expect(try JSONValue(encoding: body) == expect["body"], "\(name)")
      #expect(DiffSelectionContext.label(body) == expect["label"]?.stringValue, "\(name)")
      #expect(DiffSelectionContext.parse(try JSONValue(encoding: body), v: 1) == body, "\(name) parses again")
    }
  }

  /// The corpus's `parse` cases are the server's whole-record check; the body's part of it is ported here, with its errors.
  @Test func checksBodiesAsTheServerDoes() throws {
    let prefix = "context[0].body: "
    var checked = 0
    for c in try cases("parse") {
      guard case .array(let raw)? = c["raw"], let record = raw.first, case .object = record, record["kind"]?.stringValue == "diff_selection" else { continue }
      let name = c["name"]?.stringValue ?? "?"
      let got = DiffSelectionContext.check(record["body"] ?? .null, v: int(record["v"]) ?? 0)
      if case .array(let want)? = c["expect"]?["records"], let first = want.first {
        let body = try got.get()
        #expect(try JSONValue(encoding: body) == first["body"], "\(name)")
        #expect(DiffSelectionContext.label(body) == first["label"]?.stringValue, "\(name)")
        checked += 1
      } else if let error = c["expect"]?["error"]?.stringValue, error.hasPrefix(prefix) {
        #expect(got.failureMessage == String(error.dropFirst(prefix.count)), "\(name)")
        checked += 1
      }
    }
    #expect(checked >= 8)
  }

  /// The same, for a terminal_excerpt: its body's errors, and what it makes of a record that parses.
  @Test func checksTerminalBodiesAsTheServerDoes() throws {
    let prefix = "context[0].body: "
    var checked = 0
    for c in try cases("parse") {
      guard case .array(let raw)? = c["raw"], let record = raw.first, case .object = record, record["kind"]?.stringValue == "terminal_excerpt" else { continue }
      let name = c["name"]?.stringValue ?? "?"
      let got = TerminalExcerptContext.check(record["body"] ?? .null, v: int(record["v"]) ?? 0)
      if case .array(let want)? = c["expect"]?["records"], let first = want.first {
        let body = try got.get()
        #expect(try JSONValue(encoding: body) == first["body"], "\(name)")
        #expect(TerminalExcerptContext.label(body) == first["label"]?.stringValue, "\(name)")
        checked += 1
      } else if let error = c["expect"]?["error"]?.stringValue, error.hasPrefix(prefix) {
        #expect(got.failureMessage == String(error.dropFirst(prefix.count)), "\(name)")
        checked += 1
      }
    }
    #expect(checked >= 10)
  }

  /// What the terminal's selection becomes: each case is also run through the TypeScript, so the two cannot drift.
  @Test func selectsEveryCorpusExcerpt() throws {
    let excerpts = try cases("excerpts")
    #expect(excerpts.count >= 15)
    for c in excerpts {
      let name = c["name"]?.stringValue ?? "?"
      let s = try #require(c["source"])
      let stamp = try #require(s["at"]?.stringValue)
      let at = try #require(OmniJSON.parseDate(stamp))
      let source = TerminalExcerptContext.Source(thread: try #require(s["thread"]?.stringValue), pid: int(s["pid"]), cwd: try #require(s["cwd"]?.stringValue), at: at)
      let got = TerminalExcerptContext.select(c["raw"]?.stringValue, from: source)
      let expect = try #require(c["expect"])
      switch got {
      case .failure(let e):
        #expect(expect["error"]?.stringValue == e.message, "\(name)")
      case .success(let body):
        #expect(try JSONValue(encoding: body) == expect["body"], "\(name)")
        #expect(TerminalExcerptContext.label(body) == expect["label"]?.stringValue, "\(name)")
        #expect(TerminalExcerptContext.parse(try JSONValue(encoding: body), v: 1) == body, "\(name) parses again")
      }
      if let raw = c["raw"]?.stringValue {
        let once = TerminalExcerptContext.plainText(raw)
        #expect(TerminalExcerptContext.plainText(once) == once, "\(name) is unchanged by a second pass")
      }
    }
  }

  @Test func makesATerminalRecordAndDescribesIt() throws {
    let source = TerminalExcerptContext.Source(thread: "t1", pid: 7, cwd: "/Users/ben/code/shop", at: Date(timeIntervalSince1970: 1_792_834_215.25))
    let body = try TerminalExcerptContext.select("$ ls\nsrc", from: source).get()
    #expect(body.capturedAt == "2026-10-24T09:30:15.250Z")
    let r = MessageContext.make(TerminalExcerptContext.self, body: body, note: " why? ", id: "id-1")
    #expect((r.id, r.kind, r.v, r.label, r.note) == ("id-1", "terminal_excerpt", 1, "Terminal, 2 lines: $ ls", "why?"))
    #expect(TerminalExcerptContext.parse(r.body, v: 1) == body)
    #expect(TerminalExcerptContext.countLine(1) == "1 line selected")
    #expect(TerminalExcerptContext.countLine(3) == "3 lines selected")
  }

  /// The same, for a browser_annotation: its body's errors, and what it makes of a record that parses.
  @Test func checksBrowserBodiesAsTheServerDoes() throws {
    let prefix = "context[0].body: "
    var checked = 0
    for c in try cases("parse") {
      guard case .array(let raw)? = c["raw"], let record = raw.first, case .object = record, record["kind"]?.stringValue == "browser_annotation" else { continue }
      let name = c["name"]?.stringValue ?? "?"
      let got = BrowserAnnotationContext.check(record["body"] ?? .null, v: int(record["v"]) ?? 0)
      if case .array(let want)? = c["expect"]?["records"], let first = want.first {
        let body = try got.get()
        #expect(try JSONValue(encoding: body) == first["body"], "\(name)")
        #expect(BrowserAnnotationContext.label(body) == first["label"]?.stringValue, "\(name)")
        #expect(BrowserAnnotationContext.parse(try JSONValue(encoding: body), v: 1) == body, "\(name) parses again")
        checked += 1
      } else if let error = c["expect"]?["error"]?.stringValue, error.hasPrefix(prefix) {
        #expect(got.failureMessage == String(error.dropFirst(prefix.count)), "\(name)")
        checked += 1
      }
    }
    #expect(checked >= 30)
  }

  /// A drag on the shown screenshot becomes a rectangle in page pixels: each case is also run through the TypeScript.
  @Test func turnsEveryCorpusDragIntoARectangle() throws {
    let drags = try cases("drags")
    #expect(drags.count >= 8)
    for c in drags {
      let name = c["name"]?.stringValue ?? "?"
      func size(_ v: JSONValue?) -> (width: Double, height: Double) {
        guard case .number(let w)? = v?["width"], case .number(let h)? = v?["height"] else { return (0, 0) }
        return (w, h)
      }
      func num(_ k: String) -> Double { if case .number(let n)? = c["drag"]?[k] { n } else { 0 } }
      let drag = BrowserAnnotationContext.Drag(x0: num("x0"), y0: num("y0"), x1: num("x1"), y1: num("y1"))
      let got = BrowserAnnotationContext.dragToRect(drag, shown: size(c["shown"]), viewport: size(c["viewport"]))
      let expect = try #require(c["expect"])
      switch got {
      case .failure(let e): #expect(expect["error"]?.stringValue == e.message, "\(name)")
      case .success(let r): #expect(try JSONValue(encoding: r) == expect["rect"], "\(name)")
      }
    }
  }

  /// An element's box becomes the rectangle it is marked with: each case is also run through the TypeScript.
  @Test func marksAnElementWithItsBoxGrownToTheSmallestArea() throws {
    let rects = try cases("elementRects")
    #expect(rects.count >= 5)
    for c in rects {
      let name = c["name"]?.stringValue ?? "?"
      func rect(_ v: JSONValue?) throws -> BrowserAnnotationContext.Rect { try JSONDecoder().decode(BrowserAnnotationContext.Rect.self, from: JSONEncoder().encode(try #require(v))) }
      let viewport = try #require(c["viewport"])
      let got = BrowserAnnotationContext.elementRect(try rect(c["bounds"]), viewport: (int(viewport["width"]) ?? 0, int(viewport["height"]) ?? 0))
      #expect(got == (try rect(c["expect"])), "\(name)")
    }
  }

  @Test func placesTheRectangleOnTheImage() throws {
    let overlays = try cases("overlays")
    #expect(overlays.count >= 2)
    for c in overlays {
      let name = c["name"]?.stringValue ?? "?"
      let rect = try JSONDecoder().decode(BrowserAnnotationContext.Rect.self, from: JSONEncoder().encode(try #require(c["rect"])))
      func size(_ v: JSONValue?) -> (width: Double, height: Double) {
        guard case .number(let w)? = v?["width"], case .number(let h)? = v?["height"] else { return (0, 0) }
        return (w, h)
      }
      let got = BrowserAnnotationContext.rectInImage(rect, image: size(c["image"]), viewport: size(c["viewport"]))
      #expect(try JSONValue(encoding: got) == c["expect"], "\(name)")
    }
  }

  private func browserBody() throws -> BrowserAnnotationContext.Body {
    let record = try #require(try cases("records").first { $0["name"]?.stringValue == "a browser annotation" }?["raw"])
    let raw = try #require(record["body"])
    return try #require(BrowserAnnotationContext.parse(raw, v: 1))
  }

  @Test func giveARectangleEveryAnnotationRecordAccepts() throws {
    let base = try browserBody()
    let edges: [Double] = [-50, 0, 0.4, 7.9, 100, 357.5, 358, 900]
    var accepted = 0
    for x0 in edges { for x1 in edges { for y0 in edges { for y1 in edges {
      let drag = BrowserAnnotationContext.Drag(x0: x0, y0: y0, x1: x1, y1: y1)
      guard case .success(let r) = BrowserAnnotationContext.dragToRect(drag, shown: (358, 200), viewport: (Double(base.viewport.width), Double(base.viewport.height))) else { continue }
      var json = try JSONValue(encoding: base)
      if case .object(var o) = json { o["rect"] = try JSONValue(encoding: r); json = .object(o) }
      #expect(BrowserAnnotationContext.parse(json, v: 1) != nil)
      accepted += 1
    } } } }
    #expect(accepted > 0)
  }

  @Test func annotatesACaptureAndMakesARecordWithItsLabel() throws {
    let body = try browserBody()
    let capture = BrowserAnnotationContext.Capture(
      thread: body.thread, url: body.url, title: body.title, viewport: body.viewport, scroll: body.scroll, capturedAt: body.capturedAt, image: body.image)
    #expect(try BrowserAnnotationContext.annotate(capture, rect: body.rect).get() == body)
    #expect(BrowserAnnotationContext.annotate(capture, rect: .init(x: 1200, y: 0, width: 200, height: 20)).failureMessage == "rect reaches outside the viewport")
    #expect(BrowserAnnotationContext.annotate(capture, rect: .init(x: 0, y: 0, width: 0, height: 20)).failureMessage != nil)
    let r = MessageContext.make(BrowserAnnotationContext.self, body: body, note: " look ", id: "id-1")
    #expect((r.id, r.kind, r.v, r.label, r.note) == ("id-1", "browser_annotation", 1, "Browser, 480×160 area on shop.example.com/cart", "look"))
    #expect(BrowserAnnotationContext.parse(r.body, v: 1) == body)
  }

  @Test func readsAnyMillisecondOfACaptureTime() throws {
    let body = try browserBody()
    for stamp in ["2026-10-25T00:03:41.123Z", "2026-10-25T00:03:41.001Z", "2026-10-25T00:03:41.999Z", "2026-02-28T23:59:59.000Z"] {
      var json = try JSONValue(encoding: body)
      if case .object(var o) = json { o["captured_at"] = .string(stamp); json = .object(o) }
      #expect(BrowserAnnotationContext.parse(json, v: 1)?.capturedAt == stamp, "\(stamp)")
    }
    for stamp in ["2026-02-30T00:00:00.000Z", "2026-10-25T24:00:00.000Z", "2026-10-25T00:03:41Z", "yesterday"] {
      var json = try JSONValue(encoding: body)
      if case .object(var o) = json { o["captured_at"] = .string(stamp); json = .object(o) }
      #expect(BrowserAnnotationContext.parse(json, v: 1) == nil, "\(stamp)")
    }
  }

  @Test func readsTheAddressForTheLabelAndCleansATitle() {
    #expect(BrowserAnnotationContext.shortURL("https://shop.example.com/cart?coupon=SPRING#top") == "shop.example.com/cart")
    #expect(BrowserAnnotationContext.shortURL("HTTP://localhost:4748/") == "localhost:4748")
    let title = BrowserAnnotationContext.cleanTitle("  Cart\n\u{1b}[2J </omni-context>\u{202e} \t Example  ")
    #expect(title == "Cart [2J </omni-context> Example")
    let long = BrowserAnnotationContext.cleanTitle(String(repeating: "é", count: 400))
    #expect(long.unicodeScalars.count == 300 && long.hasSuffix("…"))
  }

  @Test func clampsToTheHunkFromIsIn() throws {
    let f = try #require(try cases("selections").first { $0["file"]?["path"]?.stringValue == "src/checkout.ts" }?["file"])
    let rows = DiffLine.number(lines(f))
    let clamp = { (a: Int, b: Int) in DiffSelectionContext.clampToHunk(rows, from: a, to: b) }
    #expect(clamp(5, 11) == (5, 7))
    #expect(clamp(11, 2) == (11, 8))
    #expect(clamp(9, 13) == (9, 13))
    #expect(clamp(0, 13) == (0, 7))
  }

  @Test func readsBlobIDsFromTheIndexLine() {
    let ids = { (h: [String]) in DiffSelectionContext.blobIds(h) }
    #expect(ids(["diff --git a/a b/a", "index fa9fb2e..a31fcc1 100644"]) == ("fa9fb2e", "a31fcc1"))
    #expect(ids(["index fa9fb2e..a31fcc1"]) == ("fa9fb2e", "a31fcc1"))
    #expect(ids(["new file mode 100644", "index 0000000..097bbee"]) == (nil, "097bbee"))
    #expect(ids(["new file mode 100644", "--- /dev/null"]) == (nil, nil))
  }

  @Test func makesARecordWithTheKindItsVersionAndItsLabel() throws {
    let body = try parsed(cart)
    let r = MessageContext.make(DiffSelectionContext.self, body: body, note: " look here ", id: "id-1")
    #expect((r.id, r.kind, r.v, r.label, r.note) == ("id-1", "diff_selection", 1, "src/cart.ts:1-3", "look here"))
    #expect(DiffSelectionContext.parse(r.body, v: 1) == body)
    #expect(!MessageContext.make(DiffSelectionContext.self, body: body, note: "").id.isEmpty)
  }

  @Test func cutsALongLabelFromTheLeftNeverInsideACodePoint() {
    #expect(MessageContext.cutLabel("src/cart.ts:1-3") == "src/cart.ts:1-3")
    let cut = MessageContext.cutLabel(String(repeating: "🛒/", count: 80) + "cart.ts:1-3")
    #expect(cut.unicodeScalars.count == MessageContext.labelMax)
    #expect(cut.hasPrefix("…🛒/"))
    #expect(cut.hasSuffix("cart.ts:1-3"))
  }

  @Test func describesTheRangeAndWhereTheLinesCameFrom() throws {
    let unstaged = try parsed(cart)
    #expect(DiffSelectionContext.range(unstaged) == "new lines 1–3")
    #expect(DiffSelectionContext.sourceLine(unstaged) == "Unstaged · HEAD 3f2a1c9 · blob a31fcc1")
    let removed = try parsed(removedInATurn)
    #expect(DiffSelectionContext.label(removed) == "src/cart.ts:2 (removed)")
    #expect(DiffSelectionContext.range(removed) == "removed line 2")
    #expect(DiffSelectionContext.sourceLine(removed) == "Turn · 1111111→2222222")
    let unstagedRemoval = removedInATurn.replacingOccurrences(of: #""group":"turn""#, with: #""group":"unstaged""#)
      .replacingOccurrences(of: #""turn":"turn-1""#, with: #""turn":null"#)
    #expect(DiffSelectionContext.sourceLine(try parsed(unstagedRemoval)) == "Unstaged · HEAD 2222222 · blob fa9fb2e", "the blob of the side shown")
  }

  @Test func picksClicksAndExtendsWithinOneHunk() throws {
    let f = try #require(try cases("selections").first { $0["file"]?["path"]?.stringValue == "src/checkout.ts" }?["file"])
    let rows = DiffLine.number(lines(f))
    var pick = LinePick.press(nil, file: "a", row: 5, extend: false, lines: rows)
    #expect(pick == LinePick(file: "a", from: 5, to: 5))
    pick = LinePick.press(pick, file: "a", row: 11, extend: true, lines: rows)
    #expect(pick == LinePick(file: "a", from: 5, to: 7), "held inside the hunk")
    #expect(pick?.range == 5...7)
    #expect(LinePick.press(pick, file: "b", row: 2, extend: true, lines: rows) == LinePick(file: "b", from: 2, to: 2), "another file starts over")
    #expect(LinePick.press(pick, file: "a", row: 3, extend: false, lines: rows) == LinePick(file: "a", from: 3, to: 3))
    #expect(LinePick.press(LinePick(file: "a", from: 3, to: 3), file: "a", row: 3, extend: false, lines: rows) == nil, "the only picked row clears")
  }

  @Test func aUserEventWithContextItCannotReadIsStillAUserEvent() throws {
    for context in ["42", "{}", #"[null, {"kind": "hologram", "v": 9}]"#, "null"] {
      let payload = EventPayload(kind: "user", json: #"{"text": "look at this", "context": \#(context)}"#)
      guard case .user(let m) = payload else {
        Issue.record("context \(context) made the event \(payload)")
        continue
      }
      #expect(m.text == "look at this")
    }
    guard case .user(let m) = EventPayload(kind: "user", json: #"{"text": "", "context": [\#(cart)]}"#) else {
      Issue.record("a context-only message is a user event")
      return
    }
    #expect(m.text.isEmpty)
    #expect(m.context.map { ContextReading.read($0, kinds: kinds).map(\.isKnown) } == [true])
  }

  @Test func aPendingMessageWithContextItCannotReadStillDecodes() throws {
    for context in ["42", "{}", #"[null, {"kind": "hologram", "v": 9}]"#, "[\(cart)]"] {
      let m = try decode(PendingMsg.self, #"{"uuid": "u1", "kind": "user", "text": "", "mode": "queue", "state": "queued", "context": \#(context)}"#)
      #expect(m.uuid == "u1", "\(context)")
    }
  }
}

extension ContextReading {
  var isKnown: Bool { if case .known = self { true } else { false } }
}
