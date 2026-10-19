import Foundation
import Testing
import OmniKit

private func decode(_ json: String) throws -> BrowserStreamMessage {
  try OmniJSON.decoder().decode(BrowserStreamMessage.self, from: Data(json.utf8))
}

@Suite struct ChannelBrowserTests {
  @Test func decodesState() throws {
    let m = try decode(#"{"type":"state","state":{"running":true,"url":"https://example.com/","title":"Example","loading":false,"canBack":true,"canForward":false,"tabs":[{"id":"A","url":"https://example.com/","title":"Example"}],"active":"A"}}"#)
    guard case let .state(s) = m else { Issue.record("not a state"); return }
    #expect(s.running && s.canBack && !s.canForward)
    #expect(s.tabs == [BrowserTabInfo(id: "A", url: "https://example.com/", title: "Example")])
    #expect(s.active == "A")
  }

  @Test func decodesFrameAndError() throws {
    let jpeg = Data([0xFF, 0xD8, 0xFF])
    guard case let .frame(f) = try decode(#"{"type":"frame","data":"\#(jpeg.base64EncodedString())","width":1280,"height":713}"#) else {
      Issue.record("not a frame"); return
    }
    #expect(f.jpeg == jpeg && f.width == 1280 && f.height == 713)
    #expect(try decode(#"{"type":"error","error":"No Chrome found"}"#) == .error("No Chrome found"))
    #expect(throws: (any Error).self) { try decode(#"{"type":"nope"}"#) }
  }

  @Test func mapsAClickOnTheScaledFrameToThePage() {
    let f = BrowserFrame(jpeg: Data(), width: 1280, height: 800)
    #expect(f.pagePoint(CGPoint(x: 160, y: 50), in: CGSize(width: 320, height: 200)) == CGPoint(x: 640, y: 200))
  }

  @Test func keys() {
    let a = BrowserKeys.key(macKeyCode: 0, characters: "a", modifiers: [])
    #expect(a.key == "a" && a.code == "KeyA" && a.keyCode == 65 && a.text == "a")
    let enter = BrowserKeys.key(macKeyCode: 36, characters: "\r", modifiers: [])
    #expect(enter.key == "Enter" && enter.keyCode == 13 && enter.text == "\r")
    let back = BrowserKeys.key(macKeyCode: 51, characters: "\u{7f}", modifiers: [])
    #expect(back.key == "Backspace" && back.text == nil)
    // Shortcuts type nothing.
    #expect(BrowserKeys.key(macKeyCode: 0, characters: "a", modifiers: .command).text == nil)
  }

  @Test func encodesInputAndActions() throws {
    let enc = JSONEncoder()
    enc.outputFormatting = .sortedKeys
    let click = String(decoding: try enc.encode(BrowserInput.mouse(.mousePressed, x: 10, y: 20, button: "left", buttons: 1, clickCount: 1, modifiers: 0)), as: UTF8.self)
    #expect(click == #"{"button":"left","buttons":1,"clickCount":1,"event":"mousePressed","modifiers":0,"type":"mouse","x":10,"y":20}"#)
    #expect(String(decoding: try enc.encode(BrowserAction.navigate("example.com")), as: UTF8.self) == #"{"action":"navigate","url":"example.com"}"#)
    #expect(String(decoding: try enc.encode(BrowserAction.tab("A")), as: UTF8.self) == #"{"action":"tab","id":"A"}"#)
  }

  @Test func decodesFaviconAndViewport() throws {
    let m = try decode(#"{"type":"state","state":{"running":true,"url":"https://example.com/","title":"","loading":false,"canBack":false,"canForward":false,"tabs":[{"id":"A","url":"https://example.com/","title":"","favicon":"https://example.com/favicon.ico"}],"active":"A","viewport":{"width":420,"height":700}}}"#)
    guard case let .state(s) = m else { Issue.record("not a state"); return }
    #expect(s.tabs.first?.favicon == "https://example.com/favicon.ico")
    #expect(s.tabs.first?.label == "example.com")
    #expect(s.viewport == BrowserViewport(width: 420, height: 700))
  }

  @Test func displaysTheAddressLikeChrome() {
    #expect(BrowserTabInfo.displayURL("https://www.example.com/") == "example.com")
    #expect(BrowserTabInfo.displayURL("https://shop.example.com/a/b?c=1") == "shop.example.com/a/b?c=1")
    #expect(BrowserTabInfo.displayURL("about:blank") == "")
    #expect(BrowserTabInfo(id: "A", url: "about:blank", title: "about:blank").label == "New Tab")
  }

  @MainActor @Test func mergesQueuedMovesAndScrolls() {
    var q: [BrowserInput] = []
    for x in [1.0, 2, 3] { ChannelBrowserModel.enqueue(&q, .mouse(.mouseMoved, x: x, y: 0, button: "none", buttons: 0, clickCount: 0, modifiers: 0)) }
    #expect(q == [.mouse(.mouseMoved, x: 3, y: 0, button: "none", buttons: 0, clickCount: 0, modifiers: 0)])
    ChannelBrowserModel.enqueue(&q, .wheel(x: 1, y: 1, deltaX: 0, deltaY: 10, modifiers: 0))
    ChannelBrowserModel.enqueue(&q, .wheel(x: 2, y: 2, deltaX: 0, deltaY: 15, modifiers: 0))
    ChannelBrowserModel.enqueue(&q, .key(.keyDown, key: "a", code: "KeyA", text: "a", keyCode: 65, modifiers: 0))
    ChannelBrowserModel.enqueue(&q, .mouse(.mouseMoved, x: 4, y: 0, button: "none", buttons: 0, clickCount: 0, modifiers: 0))
    #expect(q.count == 4)
    #expect(q[1] == .wheel(x: 2, y: 2, deltaX: 0, deltaY: 25, modifiers: 0))
  }

  @Test func encodesResize() throws {
    let enc = JSONEncoder()
    enc.outputFormatting = .sortedKeys
    #expect(String(decoding: try enc.encode(BrowserAction.resize(width: 420.4, height: 700.6, scale: 2)), as: UTF8.self) == #"{"action":"resize","height":701,"scale":2,"width":420}"#)
  }
}
