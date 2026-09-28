import Foundation
import Testing
import OmniKit

func sse(_ data: String, event: String = "message", id: String? = nil) -> SSEMessage {
  SSEMessage(event: event, data: data, id: id)
}

/// Parses `bytes` fed in the given chunks.
func parse(_ chunks: [[UInt8]]) -> (messages: [SSEMessage], parser: SSEParser) {
  var p = SSEParser()
  var out: [SSEMessage] = []
  for c in chunks { out += p.feed(c) }
  return (out, p)
}

@Suite struct SSEParserTests {
  struct Case: Sendable, CustomTestStringConvertible {
    let name: String
    let text: String
    let messages: [SSEMessage]
    var testDescription: String { name }
  }

  static let cases: [Case] = [
    Case(name: "one message", text: "data: hello\n\n", messages: [sse("hello")]),
    Case(name: "two messages", text: "data: a\n\ndata: b\n\n", messages: [sse("a"), sse("b")]),
    Case(name: "multi-line data joins with LF", text: "data: a\ndata: b\ndata: c\n\n", messages: [sse("a\nb\nc")]),
    Case(name: "ping with empty data", text: "event: ping\ndata: \n\n", messages: [sse("", event: "ping")]),
    Case(name: "id after data", text: "data: {\"id\":7}\nid: 7\n\n", messages: [sse("{\"id\":7}", id: "7")]),
    Case(name: "id is not carried to a message without one", text: "data: a\nid: 1\n\ndata: b\n\n", messages: [sse("a", id: "1"), sse("b")]),
    Case(name: "comments are skipped", text: ": hi\ndata: x\n: there\n\n", messages: [sse("x")]),
    Case(name: "a comment block alone sends nothing", text: ": keepalive\n\ndata: x\n\n", messages: [sse("x")]),
    Case(name: "no space after the colon", text: "data:x\n\n", messages: [sse("x")]),
    Case(name: "only one leading space is dropped", text: "data:  x\n\n", messages: [sse(" x")]),
    Case(name: "colons in the value stay", text: "data: {\"a\":\"b:c\"}\n\n", messages: [sse("{\"a\":\"b:c\"}")]),
    Case(name: "a field with no colon has an empty value", text: "data\n\n", messages: [sse("")]),
    Case(name: "data with an empty line in it", text: "data: a\ndata:\ndata: b\n\n", messages: [sse("a\n\nb")]),
    Case(name: "CRLF line ends", text: "data: a\r\ndata: b\r\n\r\n", messages: [sse("a\nb")]),
    Case(name: "CR line ends", text: "data: a\rdata: b\r\r", messages: [sse("a\nb")]),
    Case(name: "mixed line ends", text: "data: a\r\n\ndata: b\r\rdata: c\n\r\n", messages: [sse("a"), sse("b"), sse("c")]),
    Case(name: "a block with no data sends nothing", text: "event: ping\n\n", messages: []),
    Case(name: "event name resets after each block", text: "event: x\n\ndata: y\n\n", messages: [sse("y")]),
    Case(name: "event name resets after a dispatch", text: "event: x\ndata: 1\n\ndata: 2\n\n", messages: [sse("1", event: "x"), sse("2")]),
    Case(name: "unknown fields are skipped", text: "foo: bar\ndata: x\nDATA: y\n\n", messages: [sse("x")]),
    Case(name: "an unfinished block waits for its blank line", text: "data: a\n\ndata: b\n", messages: [sse("a")]),
    Case(name: "several blank lines in a row", text: "\n\n\ndata: a\n\n\n\n", messages: [sse("a")]),
    Case(name: "a leading BOM is dropped", text: "\u{FEFF}data: x\n\n", messages: [sse("x")]),
    Case(name: "a BOM later on is data", text: "data: \u{FEFF}x\n\n", messages: [sse("\u{FEFF}x")]),
    Case(name: "multi-byte characters", text: "data: héllo wörld 🎉 日本\n\n", messages: [sse("héllo wörld 🎉 日本")]),
    Case(name: "an id with NUL is ignored", text: "id: 1\u{0}2\ndata: x\n\n", messages: [sse("x")]),
    Case(
      name: "the server's thread stream framing",
      text: "event: ping\ndata: \n\ndata: {\"id\":1}\nid: 1\n\ndata: {\"kind\":\"thread\"}\n\n",
      messages: [sse("", event: "ping"), sse("{\"id\":1}", id: "1"), sse("{\"kind\":\"thread\"}")]
    ),
  ]

  @Test(arguments: cases)
  func parsesInOneChunk(_ c: Case) {
    #expect(parse([Array(c.text.utf8)]).messages == c.messages)
  }

  @Test(arguments: cases)
  func parsesSplitAtEveryByte(_ c: Case) {
    let bytes = Array(c.text.utf8)
    for cut in 0...bytes.count {
      let got = parse([Array(bytes[..<cut]), Array(bytes[cut...])]).messages
      #expect(got == c.messages, "split at byte \(cut)")
    }
  }

  @Test(arguments: cases)
  func parsesOneByteAtATime(_ c: Case) {
    #expect(parse(c.text.utf8.map { [$0] }).messages == c.messages)
  }

  @Test func joinsACharacterSplitAcrossChunks() {
    let bytes = Array("data: é🎉\n\n".utf8)
    // "data: " is 6 bytes, é is 2 and 🎉 is 4.
    let chunks = [Array(bytes[..<7]), Array(bytes[7..<9]), Array(bytes[9..<11]), Array(bytes[11...])]
    #expect(parse(chunks).messages == [sse("é🎉")])
  }

  @Test func doesNotReadCRThenLFInTheNextChunkAsTwoLineEnds() {
    #expect(parse([Array("data: a\r".utf8), Array("\ndata: b\r".utf8), Array("\n\r".utf8), Array("\n".utf8)]).messages == [sse("a\nb")])
  }

  @Test func replacesInvalidUTF8() {
    let bytes = Array("data: a".utf8) + [0xFF] + Array("b\n\n".utf8)
    #expect(parse([bytes]).messages == [sse("a\u{FFFD}b")])
  }

  @Test func keepsTheLastEventID() {
    let (_, p) = parse([Array("data: a\nid: 4\n\ndata: b\n\n".utf8)])
    #expect(p.lastEventID == "4")
    let (_, reset) = parse([Array("data: a\nid: 4\n\ndata: b\nid\n\n".utf8)])
    #expect(reset.lastEventID == "")
    let (_, fresh) = parse([])
    #expect(fresh.lastEventID == "")
  }

  @Test func readsRetry() {
    #expect(parse([Array("retry: 3000\n\n".utf8)]).parser.retry == .milliseconds(3000))
    #expect(parse([Array("retry: 3000\nretry: 3s\n\n".utf8)]).parser.retry == .milliseconds(3000))
    #expect(parse([Array("retry: -1\n\n".utf8)]).parser.retry == nil)
    #expect(parse([Array("retry:\n\n".utf8)]).parser.retry == nil)
  }

  @Test func takesLinesToo() {
    var p = SSEParser()
    #expect(p.line("event: ping") == nil)
    #expect(p.line("data:") == nil)
    #expect(p.line("") == sse("", event: "ping"))
    #expect(p.line("") == nil)
  }

  @Test func readsTheRecordedStreams() throws {
    let thread = parse([Array(try fixture("thread-stream.sse").utf8)]).messages
    #expect(thread.first == sse("", event: "ping"))
    let ids = thread.compactMap(\.id).compactMap(Int.init)
    #expect(!ids.isEmpty)
    #expect(ids == ids.sorted())
    #expect(thread.allSatisfy { $0.event == "message" || $0.event == "ping" })
    #expect(thread.filter { $0.id == nil && $0.event == "message" }.allSatisfy { $0.data.hasPrefix(#"{"kind":"#) })

    let feed = parse([Array(try fixture("feed.sse").utf8)]).messages
    #expect(!feed.isEmpty)
    #expect(feed.allSatisfy { $0.id == nil && $0.data.hasPrefix(#"{"type":"#) })
  }
}
