import Foundation
import Synchronization

public enum ConnectionState: Hashable, Sendable {
  case connecting
  case open
  /// The last `attempt` connections in a row failed, and the next one starts after `nextDelay`.
  case reconnecting(attempt: Int, nextDelay: Duration)
  case closed
}

/// What an `SSEClient` sends, in order: its connection state as it changes, and the messages it reads.
public enum SSEEvent<Message: Sendable>: Sendable {
  case state(ConnectionState)
  case message(Message)
}

extension SSEEvent: Equatable where Message: Equatable {}
extension SSEEvent: Hashable where Message: Hashable {}

public struct SSEResponse: Sendable {
  public var status: Int
  public var contentType: String?
  /// The body in chunks of any size. Dropping the iteration closes the connection.
  public var body: AsyncThrowingStream<Data, any Error>

  public init(status: Int, contentType: String?, body: AsyncThrowingStream<Data, any Error>) {
    self.status = status
    self.contentType = contentType
    self.body = body
  }
}

public protocol SSETransport: Sendable {
  func open(_ request: URLRequest) async throws -> SSEResponse
}

/// Opens an event stream with `URLSession.bytes`, on a session of its own so held-open streams never
/// queue behind, or in front of, API calls.
public struct URLSessionSSETransport: SSETransport {
  public static let shared = URLSessionSSETransport()

  private let session: URLSession

  public init(session: URLSession? = nil) {
    self.session = session ?? {
      let c = URLSessionConfiguration.ephemeral
      c.urlCache = nil
      c.requestCachePolicy = .reloadIgnoringLocalCacheData
      c.timeoutIntervalForRequest = 90
      c.httpMaximumConnectionsPerHost = 32
      // The server is local: never through a system proxy.
      c.connectionProxyDictionary = [:]
      return URLSession(configuration: c)
    }()
  }

  public func open(_ request: URLRequest) async throws -> SSEResponse {
    let (bytes, response) = try await session.bytes(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    let (body, out) = AsyncThrowingStream<Data, any Error>.makeStream()
    let reader = Task {
      var chunk = Data()
      do {
        for try await b in bytes {
          chunk.append(b)
          if b == 0x0A {
            out.yield(chunk)
            chunk.removeAll(keepingCapacity: true)
          }
        }
        if !chunk.isEmpty { out.yield(chunk) }
        out.finish()
      } catch {
        out.finish(throwing: error)
      }
    }
    out.onTermination = { _ in reader.cancel() }
    return SSEResponse(status: http.statusCode, contentType: http.value(forHTTPHeaderField: "Content-Type"), body: body)
  }
}

/// Keeps one server-sent event stream open, the way the Web UI's `openSSE` does: it reconnects with
/// backoff from 1s doubling to 15s, reset by every open; gives a connection up after 50s without a byte
/// (the server pings every 20s); resumes from the last id it saw and drops any id it already sent.
///
/// `events` carries the connection state and the messages in one ordered stream, so a consumer sees a
/// reconnect in line with the messages around it. Call `start()` once, and `close()` when done.
public final class SSEClient<Message: Sendable>: Sendable {
  public let events: AsyncStream<SSEEvent<Message>>

  static var watchdog: Duration { .seconds(50) }

  private enum Phase { case idle, connecting, open, waiting, closed }

  private struct State {
    var phase = Phase.idle
    var published = ConnectionState.connecting
    var cancelCurrent: (@Sendable () -> Void)?
    var runner: Task<Void, Never>?
    var forced = false
    var resetBackoff = false
    var lastActivity = Duration.zero
    var cursor: String?
    var seen: Set<String> = []
    /// `seen` in arrival order, so it can be trimmed: a replay only ever overlaps the recent past.
    var seenOrder: [String] = []
  }

  private let continuation: AsyncStream<SSEEvent<Message>>.Continuation
  private let transport: any SSETransport
  private let ticker: Ticker
  private let makeRequest: @Sendable (_ lastEventID: String?) -> URLRequest
  private let decode: @Sendable (SSEMessage) -> Message?
  private let lock: Mutex<State>

  /// - Parameters:
  ///   - lastEventID: where to resume from, passed to `request` until the stream sends an id.
  ///   - request: builds the request for each connection from the last id seen, nil when none.
  ///   - decode: turns a message into what `events` sends. Nil drops it.
  public init(
    lastEventID: String? = nil,
    transport: any SSETransport,
    clock: any Clock<Duration> = ContinuousClock(),
    request: @escaping @Sendable (_ lastEventID: String?) -> URLRequest,
    decode: @escaping @Sendable (SSEMessage) -> Message?
  ) {
    (events, continuation) = AsyncStream.makeStream()
    self.transport = transport
    self.ticker = Ticker(clock)
    self.makeRequest = request
    self.decode = decode
    var s = State()
    s.cursor = lastEventID
    self.lock = Mutex(s)
    continuation.onTermination = { [weak self] end in
      if case .cancelled = end { self?.close() }
    }
  }

  public var state: ConnectionState { lock.withLock { $0.published } }

  /// The last new id the stream sent, the cursor for the next connection. The one passed in until then.
  public var lastEventID: String? { lock.withLock { $0.cursor } }

  public func start() {
    lock.withLock { s in
      guard case .idle = s.phase else { return }
      s.phase = .connecting
      s.published = .connecting
      continuation.yield(.state(.connecting))
      s.runner = Task { await self.run() }
    }
  }

  /// Reconnects at once with a fresh backoff: drops the current connection or attempt, or skips the wait.
  /// With `ifQuietFor`, a connection that had a byte within that time is left alone. Call it with a
  /// threshold when the app comes to the front, without one when the network changes.
  public func reconnectNow(ifQuietFor quiet: Duration? = nil) {
    let cancel = lock.withLock { s -> (@Sendable () -> Void)? in
      switch s.phase {
      case .waiting:
        s.resetBackoff = true
        return s.cancelCurrent
      case .connecting, .open:
        if let quiet, ticker.now() - s.lastActivity < quiet { return nil }
        s.forced = true
        s.resetBackoff = true
        return s.cancelCurrent
      case .idle, .closed:
        return nil
      }
    }
    cancel?()
  }

  public func close() {
    let stop = lock.withLock { s -> (current: (@Sendable () -> Void)?, runner: Task<Void, Never>?)? in
      guard s.phase != .closed else { return nil }
      s.phase = .closed
      s.published = .closed
      continuation.yield(.state(.closed))
      return (s.cancelCurrent, s.runner)
    }
    guard let stop else { return }
    stop.current?()
    stop.runner?.cancel()
    continuation.finish()
  }

  private enum Next {
    case stop
    case now
    case wait(Task<Void, Never>)
  }

  private func run() async {
    var failures = 0
    while true {
      let attempt = lock.withLock { s -> Task<Bool, Never>? in
        guard s.phase != .closed else { return nil }
        s.phase = .connecting
        s.forced = false
        s.resetBackoff = false
        let t = Task { await self.connectOnce() }
        s.cancelCurrent = { t.cancel() }
        return t
      }
      guard let attempt else { return }
      let opened = await attempt.value

      let next = lock.withLock { s -> Next in
        guard s.phase != .closed else { return .stop }
        if opened || s.resetBackoff { failures = 0 }
        failures += 1
        let delay: Duration = s.forced ? .zero : min(.seconds(1 << min(failures - 1, 4)), .seconds(15))
        s.forced = false
        s.resetBackoff = false
        s.published = .reconnecting(attempt: failures, nextDelay: delay)
        continuation.yield(.state(s.published))
        guard delay > .zero else { return .now }
        let deadline = ticker.now() + delay
        s.phase = .waiting
        let w = Task { [ticker] in _ = try? await ticker.sleep(deadline) }
        s.cancelCurrent = { w.cancel() }
        return .wait(w)
      }
      switch next {
      case .stop:
        return
      case .now:
        continue
      case .wait(let w):
        await w.value
        let reset = lock.withLock { s -> Bool? in
          guard s.phase != .closed else { return nil }
          return s.resetBackoff
        }
        guard let reset else { return }
        if reset { failures = 0 }
      }
    }
  }

  /// One connection, until it ends. True when it opened.
  private func connectOnce() async -> Bool {
    let cursor = lock.withLock { s in
      s.lastActivity = ticker.now()
      return s.cursor
    }
    var request = makeRequest(cursor)
    if request.value(forHTTPHeaderField: "Accept") == nil {
      request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    }
    request.cachePolicy = .reloadIgnoringLocalCacheData

    let response: SSEResponse
    do {
      response = try await transport.open(request)
    } catch {
      return false
    }
    guard response.status == 200, Self.isEventStream(response.contentType) else {
      Self.discard(response.body)
      return false
    }
    let opened = lock.withLock { s -> Bool in
      guard s.phase == .connecting, !Task.isCancelled else { return false }
      s.phase = .open
      s.lastActivity = ticker.now()
      s.published = .open
      continuation.yield(.state(.open))
      return true
    }
    guard opened else {
      Self.discard(response.body)
      return false
    }
    await withTaskGroup(of: Void.self) { group in
      group.addTask { await self.read(response.body) }
      group.addTask { await self.watch() }
      await group.next()
      group.cancelAll()
    }
    return true
  }

  private func read(_ body: AsyncThrowingStream<Data, any Error>) async {
    var parser = SSEParser()
    do {
      for try await chunk in body {
        let messages = parser.feed(chunk)
        lock.withLock { $0.lastActivity = ticker.now() }
        for m in messages { deliver(m) }
      }
    } catch {}
  }

  /// Returns once the connection has gone `watchdog` without a byte.
  private func watch() async {
    while !Task.isCancelled {
      let deadline = lock.withLock { $0.lastActivity } + Self.watchdog
      if ticker.now() >= deadline { return }
      do {
        try await ticker.sleep(deadline)
      } catch {
        return
      }
    }
  }

  /// Sends a message on, unless its id was sent before or the client closed. Yields under the lock, so
  /// nothing follows `.closed`.
  private func deliver(_ m: SSEMessage) {
    let message = decode(m)
    lock.withLock { s in
      guard s.phase != .closed else { return }
      if let id = m.id, !id.isEmpty {
        guard s.seen.insert(id).inserted else { return }
        s.seenOrder.append(id)
        if s.seenOrder.count > 4096 {
          for old in s.seenOrder.prefix(2048) { s.seen.remove(old) }
          s.seenOrder.removeFirst(2048)
        }
        s.cursor = id
      }
      if let message { continuation.yield(.message(message)) }
    }
  }

  private static func isEventStream(_ contentType: String?) -> Bool {
    guard let type = contentType?.split(separator: ";").first else { return false }
    return type.trimmingCharacters(in: .whitespaces).lowercased() == "text/event-stream"
  }

  /// Closes a body that will not be read.
  private static func discard(_ body: AsyncThrowingStream<Data, any Error>) {
    Task { for try await _ in body {} }.cancel()
  }
}

extension OmniClient {
  /// The workspace feed. Pings and messages that do not decode are dropped.
  public func feedEvents(
    transport: any SSETransport = URLSessionSSETransport.shared, clock: any Clock<Duration> = ContinuousClock()
  ) -> SSEClient<FeedEvent> {
    let url = feedURL
    return SSEClient(transport: transport, clock: clock, request: { _ in URLRequest(url: url) }, decode: Self.json(FeedEvent.self))
  }

  /// A thread's stream from after event `after`, resuming after the last event it sent.
  public func threadEvents(
    _ id: String, after: Int,
    transport: any SSETransport = URLSessionSSETransport.shared, clock: any Clock<Duration> = ContinuousClock()
  ) -> SSEClient<ThreadStreamMessage> {
    let client = self
    return SSEClient(lastEventID: String(after), transport: transport, clock: clock, request: { cursor in
      URLRequest(url: client.threadStreamURL(id, after: cursor.flatMap { Int($0) } ?? after))
    }, decode: Self.json(ThreadStreamMessage.self))
  }

  static func json<T: Decodable & Sendable>(_ type: T.Type) -> @Sendable (SSEMessage) -> T? {
    let decoder = OmniJSON.decoder()
    return { m in
      guard m.event == "message" else { return nil }
      return try? decoder.decode(T.self, from: Data(m.data.utf8))
    }
  }
}
