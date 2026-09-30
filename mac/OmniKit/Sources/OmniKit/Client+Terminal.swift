import Foundation
import Synchronization

/// One message of `/api/threads/:id/terminal/stream` (server/terminal.ts): the recent output when a
/// client attaches, then output as it comes, and the exit.
public enum TerminalMessage: Equatable, Sendable, Decodable {
  case snapshot(data: String, running: Bool, code: Int?)
  case data(String)
  case exit(code: Int?)

  private enum Keys: String, CodingKey { case kind, data, running, code }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "snapshot":
      self = .snapshot(
        data: try c.decode(String.self, forKey: .data), running: try c.decode(Bool.self, forKey: .running),
        code: try c.decodeIfPresent(Int.self, forKey: .code))
    case "data": self = .data(try c.decode(String.self, forKey: .data))
    case "exit": self = .exit(code: try c.decodeIfPresent(Int.self, forKey: .code))
    case let kind: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown terminal message \(kind)")
    }
  }
}

/// GET, POST and DELETE /api/threads/:id/terminal.
public struct TerminalInfo: Equatable, Sendable, Decodable {
  public var open: Bool
  public var running: Bool
  public var code: Int?
  public var cwd: String?
  public var pid: Int?
  public var cols: Int?
  public var rows: Int?
}

private struct TerminalSize: Encodable, Sendable {
  let cols: Int
  let rows: Int
}

private struct TerminalInput: Encodable, Sendable {
  let data: String
}

private struct TerminalOK: Decodable {
  let ok: Bool
}

extension OmniClient {
  private func terminalPath(_ id: String, _ rest: String = "") -> String {
    "/api/threads/\(uriComponent(id))/terminal\(rest)"
  }

  public func terminal(_ id: String) async throws(OmniAPIError) -> TerminalInfo {
    try await send("GET", terminalPath(id))
  }

  /// Starts the thread's shell, or a fresh one after it exited. A running one is kept.
  public func openTerminal(_ id: String, cols: Int, rows: Int) async throws(OmniAPIError) -> TerminalInfo {
    try await send("POST", terminalPath(id), body: TerminalSize(cols: cols, rows: rows))
  }

  public func closeTerminal(_ id: String) async throws(OmniAPIError) -> TerminalInfo {
    try await send("DELETE", terminalPath(id))
  }

  /// Keystrokes. A 409 means the shell has exited.
  public func terminalInput(_ id: String, _ data: String) async throws(OmniAPIError) {
    let _: TerminalOK = try await send("POST", terminalPath(id, "/input"), body: TerminalInput(data: data))
  }

  public func resizeTerminal(_ id: String, cols: Int, rows: Int) async throws(OmniAPIError) {
    let _: TerminalOK = try await send("POST", terminalPath(id, "/resize"), body: TerminalSize(cols: cols, rows: rows))
  }

  public func terminalStreamURL(_ id: String, cols: Int, rows: Int) -> URL {
    url(terminalPath(id, "/stream"), query: [("cols", String(cols)), ("rows", String(rows))])
  }

  /// The shell's output. The server opens a shell the first time, at `size()`; every (re)connection
  /// starts with a snapshot, so the view resets on it.
  public func terminalEvents(
    _ id: String, size: @escaping @Sendable () -> (cols: Int, rows: Int),
    transport: any SSETransport = URLSessionSSETransport.shared, clock: any Clock<Duration> = ContinuousClock()
  ) -> SSEClient<TerminalMessage> {
    let client = self
    let decoder = OmniJSON.decoder()
    return SSEClient(transport: transport, clock: clock, request: { _ in
      let s = size()
      return URLRequest(url: client.terminalStreamURL(id, cols: s.cols, rows: s.rows))
    }, decode: { m in
      guard m.event == "message" else { return nil }
      return try? decoder.decode(TerminalMessage.self, from: Data(m.data.utf8))
    })
  }
}

/// Sends keystrokes in order: what is typed while a request is out goes in the next one.
public final class TerminalInputQueue: Sendable {
  private struct State {
    var pending = ""
    var sending = false
    var closed = false
  }

  private let state = Mutex(State())
  private let post: @Sendable (String) async throws -> Void
  private let onError: @Sendable (any Error) -> Void

  public init(post: @escaping @Sendable (String) async throws -> Void, onError: @escaping @Sendable (any Error) -> Void = { _ in }) {
    self.post = post
    self.onError = onError
  }

  public convenience init(client: OmniClient, thread: String, onError: @escaping @Sendable (any Error) -> Void = { _ in }) {
    self.init(post: { data in try await client.terminalInput(thread, data) }, onError: onError)
  }

  public func send(_ data: String) {
    let start = state.withLock { s -> Bool in
      guard !s.closed else { return false }
      s.pending += data
      guard !s.sending else { return false }
      s.sending = true
      return true
    }
    guard start else { return }
    Task { await self.drain() }
  }

  public func close() {
    state.withLock { $0.closed = true }
  }

  private func drain() async {
    while true {
      let next = state.withLock { s -> String? in
        guard !s.closed, !s.pending.isEmpty else {
          s.sending = false
          return nil
        }
        defer { s.pending = "" }
        return s.pending
      }
      guard let next else { return }
      do {
        try await post(next)
      } catch {
        onError(error)
      }
    }
  }
}
