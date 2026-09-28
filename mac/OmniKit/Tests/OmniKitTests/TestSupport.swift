import Foundation
import Synchronization
import Testing
import OmniKit

struct TimedOut: Error, CustomStringConvertible {
  let what: String
  var description: String { "timed out waiting for \(what)" }
}

/// Polls `condition` until it holds, for up to `within` of real time.
func eventually(
  _ what: String = "a condition", within: Duration = .seconds(2), sourceLocation: SourceLocation = #_sourceLocation,
  _ condition: () async -> Bool
) async throws {
  let end = ContinuousClock.now + within
  while !(await condition()) {
    guard ContinuousClock.now < end else {
      Issue.record("timed out waiting for \(what)", sourceLocation: sourceLocation)
      throw TimedOut(what: what)
    }
    try await Task.sleep(for: .milliseconds(1))
  }
}

/// `eventually` for main actor state: polls `condition` on the main actor, which runs its tasks in between.
@MainActor
func waitFor(
  _ what: String = "a condition", within: Duration = .seconds(2), sourceLocation: SourceLocation = #_sourceLocation,
  _ condition: () -> Bool
) async throws {
  let end = ContinuousClock.now + within
  while !condition() {
    guard ContinuousClock.now < end else {
      Issue.record("timed out waiting for \(what)", sourceLocation: sourceLocation)
      throw TimedOut(what: what)
    }
    try await Task.sleep(for: .milliseconds(1))
  }
}

/// Lets other tasks run for a moment, for checks that something did not happen.
func settle() async {
  for _ in 0..<20 {
    await Task.yield()
  }
  try? await Task.sleep(for: .milliseconds(5))
}

/// A clock that only moves when the test says so. Sleepers wake once `now` reaches their deadline.
final class TestClock: Clock, Sendable {
  struct Instant: InstantProtocol {
    var offset: Swift.Duration
    func advanced(by d: Swift.Duration) -> Instant { Instant(offset: offset + d) }
    func duration(to other: Instant) -> Swift.Duration { other.offset - offset }
    static func < (a: Instant, b: Instant) -> Bool { a.offset < b.offset }
  }

  private struct Sleeper {
    let deadline: Instant
    let wake: CheckedContinuation<Void, any Error>
  }

  private struct State {
    var now = Instant(offset: .zero)
    var sleepers: [Int: Sleeper] = [:]
    var cancelled: Set<Int> = []
    var nextID = 0
  }

  private let state = Mutex(State())

  var now: Instant { state.withLock { $0.now } }
  var minimumResolution: Swift.Duration { .zero }

  func sleep(until deadline: Instant, tolerance: Swift.Duration?) async throws {
    try Task.checkCancellation()
    let id = state.withLock { s in
      s.nextID += 1
      return s.nextID
    }
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, any Error>) in
        let now = state.withLock { s -> Bool? in
          if s.cancelled.remove(id) != nil { return false }
          if deadline <= s.now { return true }
          s.sleepers[id] = Sleeper(deadline: deadline, wake: c)
          return nil
        }
        switch now {
        case true?: c.resume()
        case false?: c.resume(throwing: CancellationError())
        case nil: break
        }
      }
    } onCancel: {
      let sleeper = state.withLock { s in
        let found = s.sleepers.removeValue(forKey: id)
        if found == nil { s.cancelled.insert(id) }
        return found
      }
      sleeper?.wake.resume(throwing: CancellationError())
    }
  }

  func advance(by d: Swift.Duration) {
    let due = state.withLock { s in
      s.now = s.now.advanced(by: d)
      let due = s.sleepers.filter { $0.value.deadline <= s.now }
      for id in due.keys { s.sleepers[id] = nil }
      return due.values.sorted { $0.deadline < $1.deadline }
    }
    for s in due { s.wake.resume() }
  }
}

/// An SSE server the test drives: every connection waits for the test to accept or refuse it.
final class ScriptedSSETransport: SSETransport {
  final class Connection: Sendable {
    let request: URLRequest
    private struct State {
      var answer: CheckedContinuation<SSEResponse, any Error>?
      /// An answer given before the client started waiting for it.
      var early: Result<SSEResponse, any Error>?
      var cancelled = false
      var answered = false
      var body: AsyncThrowingStream<Data, any Error>.Continuation?
      var dropped = false
    }
    private let state = Mutex(State())

    init(request: URLRequest) {
      self.request = request
    }

    /// The `after` query item, the cursor the client resumes from.
    var after: String? {
      URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "after" }?.value
    }

    fileprivate func wait(_ c: CheckedContinuation<SSEResponse, any Error>) {
      let now = state.withLock { s -> Result<SSEResponse, any Error>? in
        if s.cancelled { return .failure(CancellationError()) }
        if let early = s.early { return early }
        s.answer = c
        return nil
      }
      if let now { c.resume(with: now) }
    }

    fileprivate func cancel() {
      let answer = state.withLock { s in
        s.cancelled = true
        defer { s.answer = nil }
        return s.answer
      }
      answer?.resume(throwing: CancellationError())
    }

    private func answer(_ result: Result<SSEResponse, any Error>) {
      let answer = state.withLock { s in
        defer { s.answer = nil }
        s.answered = true
        if s.answer == nil { s.early = result }
        return s.answer
      }
      answer?.resume(with: result)
    }

    func accept(status: Int = 200, contentType: String? = "text/event-stream") {
      let (stream, body) = AsyncThrowingStream<Data, any Error>.makeStream()
      body.onTermination = { [weak self] _ in self?.state.withLock { $0.dropped = true } }
      state.withLock { $0.body = body }
      answer(.success(SSEResponse(status: status, contentType: contentType, body: stream)))
    }

    func refuse(_ code: URLError.Code = .cannotConnectToHost) {
      answer(.failure(URLError(code)))
    }

    func send(_ text: String) {
      send(bytes: Array(text.utf8))
    }

    func send(bytes: [UInt8]) {
      _ = state.withLock { $0.body }?.yield(Data(bytes))
    }

    /// The server closes the stream.
    func end() {
      state.withLock { $0.body }?.finish()
    }

    /// The client gave the connection up, or the server ended it.
    var isDropped: Bool { state.withLock { $0.dropped } }
    var isAnswered: Bool { state.withLock { $0.answered || $0.cancelled } }
  }

  private let opened = Mutex<[Connection]>([])
  private let taken = Mutex(0)

  func open(_ request: URLRequest) async throws -> SSEResponse {
    let conn = Connection(request: request)
    opened.withLock { $0.append(conn) }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { conn.wait($0) }
    } onCancel: {
      conn.cancel()
    }
  }

  /// How many times the client has connected.
  var count: Int { opened.withLock { $0.count } }

  /// The client's next connection, in order.
  func next(sourceLocation: SourceLocation = #_sourceLocation) async throws -> Connection {
    let i = taken.withLock { n in
      defer { n += 1 }
      return n
    }
    try await eventually("connection \(i + 1)", sourceLocation: sourceLocation) { count > i }
    return opened.withLock { $0[i] }
  }
}

/// Collects what an `SSEClient` sends, to read back in order.
final class Recorder<Message: Sendable>: Sendable {
  private let items = Mutex<[SSEEvent<Message>]>([])
  private let read = Mutex(0)
  private let done = Mutex(false)

  init(_ events: AsyncStream<SSEEvent<Message>>) {
    Task {
      for await e in events { self.items.withLock { $0.append(e) } }
      self.done.withLock { $0 = true }
    }
  }

  var all: [SSEEvent<Message>] { items.withLock { $0 } }
  var finished: Bool { done.withLock { $0 } }
  /// Items not read with `next()` yet.
  var unread: [SSEEvent<Message>] {
    let i = read.withLock { $0 }
    return Array(all.dropFirst(i))
  }

  func next(sourceLocation: SourceLocation = #_sourceLocation) async throws -> SSEEvent<Message> {
    let i = read.withLock { n in
      defer { n += 1 }
      return n
    }
    try await eventually("event \(i + 1)", sourceLocation: sourceLocation) { items.withLock { $0.count } > i }
    return items.withLock { $0[i] }
  }
}

/// Holds a call until the test opens it.
final class Gate: Sendable {
  private struct State {
    var open = false
    var waiters: [CheckedContinuation<Void, Never>] = []
  }
  private let state = Mutex(State())

  func wait() async {
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
      let now = state.withLock { s in
        if s.open { return true }
        s.waiters.append(c)
        return false
      }
      if now { c.resume() }
    }
  }

  func open() {
    let waiters = state.withLock { s in
      s.open = true
      defer { s.waiters = [] }
      return s.waiters
    }
    for w in waiters { w.resume() }
  }
}
