import Foundation

/// One tab of a channel browser.
public struct BrowserTabInfo: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var url: String
  public var title: String
  /// The page's icon, or its origin's /favicon.ico. Absent for blank and non-web pages.
  public var favicon: String?

  public init(id: String, url: String, title: String, favicon: String? = nil) {
    self.id = id
    self.url = url
    self.title = title
    self.favicon = favicon
  }

  /// The title as the tab shows it.
  public var label: String {
    if !title.isEmpty, title != "about:blank" { return title }
    let shown = BrowserTabInfo.displayURL(url)
    return shown.isEmpty ? "New Tab" : shown
  }

  /// The address as Chrome shows it at rest: no scheme, no www, no trailing slash on a bare host.
  public static func displayURL(_ url: String) -> String {
    guard !url.isEmpty, url != "about:blank" else { return "" }
    var s = url
    for p in ["https://", "http://"] where s.hasPrefix(p) { s.removeFirst(p.count) }
    if s.hasPrefix("www.") { s.removeFirst(4) }
    if s.hasSuffix("/"), s.dropLast().allSatisfy({ !"/?#".contains($0) }) { s.removeLast() }
    return s
  }
}

/// A page viewport in CSS pixels.
public struct BrowserViewport: Codable, Hashable, Sendable {
  public var width: Double
  public var height: Double
  public init(width: Double, height: Double) {
    self.width = width
    self.height = height
  }
}

/// The channel browser as `GET /api/channels/:id/browser` and its stream send it.
public struct BrowserState: Codable, Hashable, Sendable {
  public var running: Bool
  public var url: String
  public var title: String
  public var loading: Bool
  public var canBack: Bool
  public var canForward: Bool
  public var tabs: [BrowserTabInfo]
  public var active: String?
  /// The size the page lays out at: the viewer's while one is watching.
  public var viewport: BrowserViewport?

  public static let stopped = BrowserState(running: false, url: "", title: "", loading: false, canBack: false, canForward: false, tabs: [], active: nil)

  public init(running: Bool, url: String, title: String, loading: Bool, canBack: Bool, canForward: Bool, tabs: [BrowserTabInfo], active: String?, viewport: BrowserViewport? = nil) {
    self.viewport = viewport
    self.running = running
    self.url = url
    self.title = title
    self.loading = loading
    self.canBack = canBack
    self.canForward = canForward
    self.tabs = tabs
    self.active = active
  }
}

/// One JPEG of the page, and the page viewport in CSS pixels it shows.
public struct BrowserFrame: Hashable, Sendable {
  public var jpeg: Data
  public var width: Double
  public var height: Double

  public init(jpeg: Data, width: Double, height: Double) {
    self.jpeg = jpeg
    self.width = width
    self.height = height
  }

  /// The page point under `point` in a view `size` points big showing the frame at full width.
  public func pagePoint(_ point: CGPoint, in size: CGSize) -> CGPoint {
    guard size.width > 0 else { return .zero }
    let scale = width / size.width
    return CGPoint(x: (point.x * scale).rounded(), y: (point.y * scale).rounded())
  }
}

/// What `/api/channels/:id/browser/stream` sends.
public enum BrowserStreamMessage: Hashable, Sendable, Decodable {
  case state(BrowserState)
  case frame(BrowserFrame)
  case error(String)

  private enum Keys: String, CodingKey { case type, state, data, width, height, error }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    switch try c.decode(String.self, forKey: .type) {
    case "state":
      self = .state(try c.decode(BrowserState.self, forKey: .state))
    case "frame":
      let b64 = try c.decode(String.self, forKey: .data)
      guard let jpeg = Data(base64Encoded: b64) else { throw DecodingError.dataCorruptedError(forKey: .data, in: c, debugDescription: "not base64") }
      self = .frame(BrowserFrame(jpeg: jpeg, width: try c.decode(Double.self, forKey: .width), height: try c.decode(Double.self, forKey: .height)))
    case "error":
      self = .error(try c.decode(String.self, forKey: .error))
    case let other:
      throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown type \(other)")
    }
  }
}

/// Input for the page, the shapes `POST /api/channels/:id/browser/input` takes.
public enum BrowserInput: Encodable, Hashable, Sendable {
  public enum MouseEvent: String, Encodable, Sendable { case mousePressed, mouseReleased, mouseMoved }
  public enum KeyEvent: String, Encodable, Sendable { case keyDown, keyUp }

  case mouse(MouseEvent, x: Double, y: Double, button: String, buttons: Int, clickCount: Int, modifiers: Int)
  case wheel(x: Double, y: Double, deltaX: Double, deltaY: Double, modifiers: Int)
  case key(KeyEvent, key: String, code: String, text: String?, keyCode: Int, modifiers: Int)
  case text(String)

  private enum Keys: String, CodingKey { case type, event, x, y, button, buttons, clickCount, modifiers, deltaX, deltaY, key, code, text, keyCode }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    switch self {
    case let .mouse(event, x, y, button, buttons, clickCount, modifiers):
      try c.encode("mouse", forKey: .type)
      try c.encode(event, forKey: .event)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(button, forKey: .button)
      try c.encode(buttons, forKey: .buttons)
      try c.encode(clickCount, forKey: .clickCount)
      try c.encode(modifiers, forKey: .modifiers)
    case let .wheel(x, y, deltaX, deltaY, modifiers):
      try c.encode("wheel", forKey: .type)
      try c.encode(x, forKey: .x)
      try c.encode(y, forKey: .y)
      try c.encode(deltaX, forKey: .deltaX)
      try c.encode(deltaY, forKey: .deltaY)
      try c.encode(modifiers, forKey: .modifiers)
    case let .key(event, key, code, text, keyCode, modifiers):
      try c.encode("key", forKey: .type)
      try c.encode(event, forKey: .event)
      try c.encode(key, forKey: .key)
      try c.encode(code, forKey: .code)
      try c.encodeIfPresent(text, forKey: .text)
      try c.encode(keyCode, forKey: .keyCode)
      try c.encode(modifiers, forKey: .modifiers)
    case let .text(text):
      try c.encode("text", forKey: .type)
      try c.encode(text, forKey: .text)
    }
  }
}

/// `POST /api/channels/:id/browser/action`.
public enum BrowserAction: Encodable, Hashable, Sendable {
  case navigate(String)
  case back, forward, reload, stop, restart
  case newTab
  case tab(String)
  case closeTab(String)
  /// The viewer's size in points, and its backing scale, so the page lays out to fit it.
  case resize(width: Double, height: Double, scale: Double)

  private enum Keys: String, CodingKey { case action, url, id, width, height, scale }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    switch self {
    case let .navigate(url):
      try c.encode("navigate", forKey: .action)
      try c.encode(url, forKey: .url)
    case .back: try c.encode("back", forKey: .action)
    case .forward: try c.encode("forward", forKey: .action)
    case .reload: try c.encode("reload", forKey: .action)
    case .stop: try c.encode("stop", forKey: .action)
    case .restart: try c.encode("restart", forKey: .action)
    case .newTab: try c.encode("newTab", forKey: .action)
    case let .tab(id):
      try c.encode("tab", forKey: .action)
      try c.encode(id, forKey: .id)
    case let .closeTab(id):
      try c.encode("closeTab", forKey: .action)
      try c.encode(id, forKey: .id)
    case let .resize(width, height, scale):
      try c.encode("resize", forKey: .action)
      try c.encode(width.rounded(), forKey: .width)
      try c.encode(height.rounded(), forKey: .height)
      try c.encode(scale, forKey: .scale)
    }
  }
}

private struct OKReply: Decodable { let ok: Bool }
private struct InputBatch: Encodable { let events: [BrowserInput] }
private struct CopyReply: Decodable { let text: String }

extension OmniClient {
  public func browserStreamURL(channel: String) -> URL {
    url("/api/channels/\(uriComponent(channel))/browser/stream")
  }

  /// The channel browser, live. Opening it starts the browser.
  public func browserEvents(
    channel: String, transport: any SSETransport = URLSessionSSETransport.shared, clock: any Clock<Duration> = ContinuousClock()
  ) -> SSEClient<BrowserStreamMessage> {
    let url = browserStreamURL(channel: channel)
    return SSEClient(transport: transport, clock: clock, request: { _ in URLRequest(url: url) }, decode: Self.json(BrowserStreamMessage.self))
  }

  public func browserInput(channel: String, _ input: BrowserInput) async throws(OmniAPIError) {
    try await browserInput(channel: channel, [input])
  }

  /// Several events in order, in one request.
  public func browserInput(channel: String, _ events: [BrowserInput]) async throws(OmniAPIError) {
    let _: OKReply = try await send("POST", "/api/channels/\(uriComponent(channel))/browser/input", body: InputBatch(events: events))
  }

  /// The text selected in the page, for Cmd-C.
  public func browserCopy(channel: String) async throws(OmniAPIError) -> String {
    let r: CopyReply = try await send("POST", "/api/channels/\(uriComponent(channel))/browser/copy", body: [String: String]())
    return r.text
  }

  public func browserAction(channel: String, _ action: BrowserAction) async throws(OmniAPIError) -> BrowserState {
    try await send("POST", "/api/channels/\(uriComponent(channel))/browser/action", body: action)
  }
}

/// CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8.
public struct BrowserModifiers: OptionSet, Hashable, Sendable {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }
  public static let alt = BrowserModifiers(rawValue: 1)
  public static let control = BrowserModifiers(rawValue: 2)
  public static let command = BrowserModifiers(rawValue: 4)
  public static let shift = BrowserModifiers(rawValue: 8)
}

/// The DOM `key`, `code`, Windows key code and typed text for a Mac key, as CDP wants them.
public enum BrowserKeys {
  public struct Key: Hashable, Sendable {
    public var key: String
    public var code: String
    public var keyCode: Int
    public var text: String?
  }

  /// Mac virtual key codes of the keys that type nothing.
  static let special: [UInt16: (String, String, Int)] = [
    36: ("Enter", "Enter", 13), 76: ("Enter", "NumpadEnter", 13), 48: ("Tab", "Tab", 9), 51: ("Backspace", "Backspace", 8),
    117: ("Delete", "Delete", 46), 53: ("Escape", "Escape", 27), 123: ("ArrowLeft", "ArrowLeft", 37), 124: ("ArrowRight", "ArrowRight", 39),
    125: ("ArrowDown", "ArrowDown", 40), 126: ("ArrowUp", "ArrowUp", 38), 115: ("Home", "Home", 36), 119: ("End", "End", 35),
    116: ("PageUp", "PageUp", 33), 121: ("PageDown", "PageDown", 34),
  ]

  /// `characters` is what the key types with its modifiers, as NSEvent gives it.
  public static func key(macKeyCode: UInt16, characters: String?, modifiers: BrowserModifiers) -> Key {
    if let (key, code, vk) = special[macKeyCode] {
      return Key(key: key, code: code, keyCode: vk, text: key == "Enter" && !modifiers.contains(.command) ? "\r" : nil)
    }
    let ch = characters ?? ""
    let upper = ch.uppercased()
    let vk: Int = {
      guard let s = upper.unicodeScalars.first, upper.unicodeScalars.count == 1 else { return 0 }
      if ("A"..."Z").contains(Character(s)) || ("0"..."9").contains(Character(s)) { return Int(s.value) }
      return ch == " " ? 32 : 0
    }()
    let code: String = {
      guard let s = upper.first, upper.count == 1 else { return "" }
      if s.isLetter, s.isASCII { return "Key\(s)" }
      if s.isNumber, s.isASCII { return "Digit\(s)" }
      return ch == " " ? "Space" : ""
    }()
    let typed = modifiers.contains(.command) || modifiers.contains(.control) || ch.isEmpty ? nil : ch
    return Key(key: ch.isEmpty ? "Unidentified" : ch, code: code, keyCode: vk, text: typed)
  }
}

/// The thread inspector's live browser: the frames and state of the channel's Chrome, and a way to
/// drive it. Input goes out in order, so a key up never overtakes its key down.
@MainActor @Observable
public final class ChannelBrowserModel {
  public private(set) var state = BrowserState.stopped
  public private(set) var frame: BrowserFrame?
  public private(set) var error: String?
  public private(set) var connection = ConnectionState.connecting

  public let channel: String
  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private var stream: SSEClient<BrowserStreamMessage>?
  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private var pending: [BrowserInput] = []
  @ObservationIgnored private var sending = false
  @ObservationIgnored private var size: (width: Double, height: Double, scale: Double)?

  public init(client: OmniClient, channel: String) {
    self.client = client
    self.channel = channel
  }

  public func start() {
    guard task == nil else { return }
    let s = client.browserEvents(channel: channel)
    stream = s
    task = Task { [weak self] in
      for await e in s.events {
        guard let self else { return }
        self.handle(e)
      }
    }
    s.start()
  }

  public func stop() {
    stream?.close()
    stream = nil
    task?.cancel()
    task = nil
  }

  func handle(_ e: SSEEvent<BrowserStreamMessage>) {
    switch e {
    case let .state(c):
      connection = c
      if c == .open {
        error = nil
        if let s = size { perform(.resize(width: s.width, height: s.height, scale: s.scale)) }
      }
    case let .message(.state(s)):
      let started = s.running && !state.running
      state = s
      if !s.running { frame = nil }
      if started, let z = size { perform(.resize(width: z.width, height: z.height, scale: z.scale)) }
    case let .message(.frame(f)):
      frame = f
    case let .message(.error(text)):
      error = text
    }
  }

  /// Input goes out in order, a batch at a time: while one is on its way, the next queues and
  /// merges (moves keep the newest, scrolls add up), so a busy page never falls behind the mouse.
  public func send(_ input: BrowserInput) {
    Self.enqueue(&pending, input)
    flush()
  }

  public static func enqueue(_ q: inout [BrowserInput], _ e: BrowserInput) {
    switch (q.last, e) {
    case (.mouse(.mouseMoved, _, _, _, _, _, _)?, .mouse(.mouseMoved, _, _, _, _, _, _)):
      q[q.count - 1] = e
    case let (.wheel(_, _, dx0, dy0, m0)?, .wheel(x, y, dx, dy, m)) where m0 == m:
      q[q.count - 1] = .wheel(x: x, y: y, deltaX: dx0 + dx, deltaY: dy0 + dy, modifiers: m)
    default:
      q.append(e)
    }
  }

  private func flush() {
    guard !sending, !pending.isEmpty else { return }
    sending = true
    let events = pending
    pending = []
    let client = client, channel = channel
    Task { [weak self] in
      try? await client.browserInput(channel: channel, events)
      guard let self else { return }
      self.sending = false
      self.flush()
    }
  }

  /// The view's size. The page lays out to fit it; the same size again sends nothing.
  public func resize(width: Double, height: Double, scale: Double) {
    guard width > 0, height > 0 else { return }
    if let s = size, abs(s.width - width) < 1, abs(s.height - height) < 1, s.scale == scale { return }
    size = (width, height, scale)
    perform(.resize(width: width, height: height, scale: scale))
  }

  /// Claims the page size for this view again, after another viewer (the web panel) changed it.
  public func claimSize() {
    guard let s = size, state.running else { return }
    if let v = state.viewport, abs(v.width - s.width.rounded()) <= 1, abs(v.height - s.height.rounded()) <= 1 { return }
    perform(.resize(width: s.width, height: s.height, scale: s.scale))
  }

  /// The page's selected text, for Cmd-C.
  public func copySelection() async -> String {
    (try? await client.browserCopy(channel: channel)) ?? ""
  }

  public func perform(_ action: BrowserAction) {
    let client = client, channel = channel
    Task { [weak self] in
      do throws(OmniAPIError) {
        let s = try await client.browserAction(channel: channel, action)
        self?.state = s
        self?.error = nil
        if case .restart = action {
          self?.stop()
          self?.start()
        }
      } catch {
        self?.error = error.message
      }
    }
  }
}
