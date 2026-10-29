import Foundation

/// Sends one HTTP request. Swap it in tests; the app uses `URLSessionTransport`.
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
  public let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return (data, http)
  }
}

public enum OmniAPIError: Error, Hashable, Sendable, LocalizedError {
  /// No answer at all: the server is down or the connection failed.
  case unreachable(String)
  /// A non-2xx answer. `message` is the server's `{error}`, or its text.
  case http(status: Int, message: String)
  /// A 2xx answer that is not JSON, like the Web UI's index.html for a path the server does not route.
  case notJSON(status: Int, contentType: String?)
  /// JSON that does not fit the type asked for.
  case decoding(String)
  case cancelled

  /// Short, plain text to show.
  public var message: String {
    switch self {
    case .unreachable: "Cannot reach the Omni server. Is it running?"
    case .http(_, let message): message
    case .notJSON(let status, let type): "The server answered \(status) with \(type ?? "no content type"), not JSON."
    case .decoding(let detail): "The server sent data this app can't read: \(detail)"
    case .cancelled: "Cancelled."
    }
  }

  public var errorDescription: String? { message }
}

/// POST /api/threads.
public struct NewThread: Encodable, Hashable, Sendable {
  public var channel: String
  public var prompt: String
  public var role: String?
  public var model: String?
  public var harness: HarnessID?
  /// nil for the model's default.
  public var effort: String?
  /// nil to let the server title it.
  public var title: String?
  public var parentID: String?
  public var taskID: String?
  public var source: ThreadSource?
  /// A sidebar folder of the channel to file it in, by id.
  public var folder: String?
  /// Where a worktree thread's branch starts. nil for the repo's current commit.
  public var base: BasePick?
  /// Where it runs (RunOn.swift): a synced machine's id, "here" for this Mac, nil for Settings' default.
  public var device: String?

  public init(
    channel: String, prompt: String, role: String? = nil, model: String? = nil, harness: HarnessID? = nil,
    effort: String? = nil, title: String? = nil, parentID: String? = nil, taskID: String? = nil, source: ThreadSource? = nil,
    folder: String? = nil, base: BasePick? = nil, device: String? = nil
  ) {
    self.channel = channel
    self.prompt = prompt
    self.role = role
    self.model = model
    self.harness = harness
    self.effort = effort
    self.title = title
    self.parentID = parentID
    self.taskID = taskID
    self.source = source
    self.folder = folder
    self.base = base
    self.device = device
  }

  enum CodingKeys: String, CodingKey {
    case channel, prompt, role, model, harness, effort, title, source, folder, base, device
    case parentID = "parent_id"
    case taskID = "task_id"
  }
}

private struct MessageBody: Encodable, Sendable {
  let prompt: String
  let mode: SendMode
}

private struct TitleBody: Encodable, Sendable {
  let title: String
}

private struct ArchivedBody: Encodable, Sendable {
  let archived: Bool
}

private struct PinnedBody: Encodable, Sendable {
  let pinned: Bool
}

private struct DoneBody: Encodable, Sendable {
  let done: Bool
}

/// `{"next_thread": null}`: an explicit null, which a nil optional would leave out.
private struct DismissNextBody: Encodable, Sendable {
  enum CodingKeys: String, CodingKey { case nextThread = "next_thread" }
  func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encodeNil(forKey: .nextThread)
  }
}

private struct ErrorBody: Decodable {
  let error: String
}

/// The Omni server's HTTP API, one method per endpoint. Every method throws `OmniAPIError`.
public struct OmniClient: Sendable {
  public let baseURL: URL
  /// Sent as `Authorization: Bearer` on every request (apps/server/request-guard.ts).
  public let token: ServerToken
  let transport: any HTTPTransport

  public init(baseURL: URL, token: ServerToken = .none, transport: any HTTPTransport = URLSessionTransport()) {
    self.baseURL = baseURL
    self.token = token
    self.transport = transport
  }

  public init(host: String = "127.0.0.1", port: Int = 4747, token: ServerToken = .none, transport: any HTTPTransport = URLSessionTransport()) {
    let h = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    guard let url = URL(string: "http://\(h):\(port)") else { preconditionFailure("Not a host: \(host)") }
    self.init(baseURL: url, token: token, transport: transport)
  }

  /// `url` is on this server: the same scheme, host and port as `baseURL`. Only those requests get the token.
  public func isOwn(_ url: URL) -> Bool {
    url.scheme?.lowercased() == baseURL.scheme?.lowercased() && url.host()?.lowercased() == baseURL.host()?.lowercased()
      && (url.port ?? 80) == (baseURL.port ?? 80)
  }

  /// A request for `url`, with the token when `url` is on this server and without it anywhere else. For the event
  /// streams, which build their own, and for images, whose URLs can come from a model's markdown.
  public func authorized(_ url: URL) -> URLRequest {
    var req = URLRequest(url: url)
    if isOwn(url), let t = token.value { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
    return req
  }

  /// An image's bytes. One on this server goes through this client, with the token; any other URL (another port
  /// included) goes through `external`, with no token and no cookie. Nothing puts the token in a shared cookie store.
  public func imageData(_ url: URL, external: any HTTPTransport = URLSessionTransport()) async throws(OmniAPIError) -> Data {
    if isOwn(url) { return try await file(url) }
    do {
      let (data, response) = try await external.send(URLRequest(url: url))
      guard (200..<300).contains(response.statusCode) else { throw OmniAPIError.http(status: response.statusCode, message: "Request failed (\(response.statusCode))") }
      return data
    } catch let e as OmniAPIError {
      throw e
    } catch {
      throw .unreachable(error.localizedDescription)
    }
  }

  // MARK: Endpoints

  public func status() async throws(OmniAPIError) -> Status {
    try await send("GET", "/api/status")
  }

  public func channels(archived: Bool = false) async throws(OmniAPIError) -> [ChannelWithRunning] {
    try await send("GET", "/api/channels", query: archived ? [("archived", "1")] : [])
  }

  public func channel(_ id: String) async throws(OmniAPIError) -> ChannelWithRunning {
    try await send("GET", "/api/channels/\(uriComponent(id))")
  }

  /// A channel's threads, most recently updated first. With `archived`, only its archived ones.
  public func channelThreads(_ id: String, archived: Bool = false) async throws(OmniAPIError) -> [OmniThread] {
    try await send("GET", "/api/channels/\(uriComponent(id))/threads", query: archived ? [("archived", "1")] : [])
  }

  public func threads(channel: String? = nil, status: ThreadStatus? = nil, limit: Int? = nil) async throws(OmniAPIError) -> [OmniThread] {
    var query: [(String, String)] = []
    if let channel { query.append(("channel", channel)) }
    if let status { query.append(("status", status.rawValue)) }
    if let limit { query.append(("limit", String(limit))) }
    return try await send("GET", "/api/threads", query: query)
  }

  /// Threads across every channel, most recently updated first.
  public func recent(limit: Int? = nil) async throws(OmniAPIError) -> [OmniThread] {
    try await send("GET", "/api/recent", query: limit.map { [("limit", String($0))] } ?? [])
  }

  /// Full-text search over every thread: prefix matches, at most 40, best first.
  public func search(_ query: String) async throws(OmniAPIError) -> [SearchHit] {
    try await send("GET", "/api/search", query: [("q", query)])
  }

  /// A thread with its transcript, artifacts, children, parent and pending messages.
  public func thread(_ id: String) async throws(OmniAPIError) -> ThreadDetail {
    try await send("GET", "/api/threads/\(uriComponent(id))")
  }

  public func crew() async throws(OmniAPIError) -> [CrewRole] {
    try await send("GET", "/api/crew")
  }

  public func harnesses() async throws(OmniAPIError) -> [HarnessInfo] {
    try await send("GET", "/api/harnesses")
  }

  /// The harnesses as a channel sees them: Cursor Cloud is unavailable in a channel with no GitHub repo.
  public func harnesses(channel: String) async throws(OmniAPIError) -> [HarnessInfo] {
    try await send("GET", "/api/harnesses", query: [("channel", channel)])
  }

  public func createThread(_ new: NewThread) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads", body: new)
  }

  public func sendMessage(to id: String, prompt: String, mode: SendMode = .steer) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(id))/messages", body: MessageBody(prompt: prompt, mode: mode))
  }

  public func renameThread(_ id: String, title: String) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: TitleBody(title: title))
  }

  public func archiveThread(_ id: String, archived: Bool = true) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: ArchivedBody(archived: archived))
  }

  /// Pins the thread to the sidebar's Pinned section, or unpins it. An archived thread is refused (409).
  public func pinThread(_ id: String, pinned: Bool = true) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: PinnedBody(pinned: pinned))
  }

  /// Marks the thread done (out of Needs you until something new happens in it), or not done. A running thread is
  /// refused (409).
  public func markThreadDone(_ id: String, done: Bool = true) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: DoneBody(done: done))
  }

  /// The sidebar's Pinned section: pinned threads in every channel, the latest pin first, without archived ones.
  public func pinned() async throws(OmniAPIError) -> [ThreadStub] {
    try await send("GET", "/api/pinned")
  }

  /// Drops the thread's proposed follow-up thread, the card under its transcript.
  public func dismissNextThread(_ id: String) async throws(OmniAPIError) -> OmniThread {
    try await send("PATCH", "/api/threads/\(uriComponent(id))", body: DismissNextBody())
  }

  public func stopThread(_ id: String) async throws(OmniAPIError) -> OmniThread {
    try await send("POST", "/api/threads/\(uriComponent(id))/stop")
  }

  // MARK: Streams

  /// SSE of `ThreadStreamMessage`. `after` is the last event id already shown.
  public func threadStreamURL(_ id: String, after: Int) -> URL {
    url("/api/threads/\(uriComponent(id))/stream", query: [("after", String(after))])
  }

  /// SSE of `FeedEvent`.
  public var feedURL: URL { url("/api/feed") }

  // MARK: Plumbing

  func url(_ path: String, query: [(String, String)] = []) -> URL {
    let q = query.map { "\(uriComponent($0.0))=\(uriComponent($0.1))" }.joined(separator: "&")
    let text = baseURL.absoluteString + path + (q.isEmpty ? "" : "?\(q)")
    guard let url = URL(string: text) else { preconditionFailure("Not a URL: \(text)") }
    return url
  }

  func send<T: Decodable>(
    _ method: String, _ path: String, query: [(String, String)] = [], body: (any Encodable & Sendable)? = nil,
    raw: (data: Data, contentType: String)? = nil
  ) async throws(OmniAPIError) -> T {
    let (data, response) = try await exchange(request(method, path, query: query, body: body, raw: raw))
    return try Self.decoded(data, response)
  }

  /// The request `send` makes: the token, JSON accepted, and a JSON body or `raw` as it is.
  func request(
    _ method: String, _ path: String, query: [(String, String)] = [], body: (any Encodable & Sendable)? = nil,
    raw: (data: Data, contentType: String)? = nil
  ) throws(OmniAPIError) -> URLRequest {
    var req = authorized(url(path, query: query))
    req.httpMethod = method
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    if let raw {
      req.setValue(raw.contentType, forHTTPHeaderField: "Content-Type")
      req.httpBody = raw.data
    } else if let body {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      do {
        req.httpBody = try OmniJSON.encoder().encode(body)
      } catch {
        throw .decoding("could not encode the request: \(error)")
      }
    }
    return req
  }

  /// A 2xx answer as `T`. Anything but JSON is `.notJSON`.
  static func decoded<T: Decodable>(_ data: Data, _ response: HTTPURLResponse) throws(OmniAPIError) -> T {
    let type = response.value(forHTTPHeaderField: "Content-Type")
    guard isJSON(type) else { throw .notJSON(status: response.statusCode, contentType: type) }
    do {
      return try OmniJSON.decoder().decode(T.self, from: data)
    } catch {
      throw .decoding(describe(error))
    }
  }

  /// A file the server serves, such as an upload, as it is.
  public func file(_ url: URL) async throws(OmniAPIError) -> Data {
    var req = authorized(url)
    req.cachePolicy = .reloadIgnoringLocalCacheData
    return try await exchange(req).0
  }

  /// Sends the request. A status outside 2xx throws with the server's message.
  private func exchange(_ req: URLRequest) async throws(OmniAPIError) -> (Data, HTTPURLResponse) {
    let (data, response) = try await deliver(req)
    guard (200..<300).contains(response.statusCode) else { throw Self.failure(data, response) }
    return (data, response)
  }

  /// Sends the request and hands back the answer whatever its status: only no answer at all throws. For a call whose
  /// refusals carry more than `{error}`.
  func deliver(_ req: URLRequest) async throws(OmniAPIError) -> (Data, HTTPURLResponse) {
    do {
      return try await transport.send(req)
    } catch let e as URLError where e.code == .cancelled {
      throw .cancelled
    } catch is CancellationError {
      throw .cancelled
    } catch {
      throw .unreachable(error.localizedDescription)
    }
  }

  /// A status outside 2xx as the error `send` throws.
  static func failure(_ data: Data, _ response: HTTPURLResponse) -> OmniAPIError {
    let type = response.value(forHTTPHeaderField: "Content-Type")
    return .http(status: response.statusCode, message: errorMessage(data, contentType: type, status: response.statusCode))
  }

  static func isJSON(_ contentType: String?) -> Bool {
    guard let media = contentType?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased() else { return false }
    return media == "application/json" || media.hasSuffix("+json")
  }

  /// Like the Web UI: the `{error}` field, else the first 300 characters of the text, else the status.
  static func errorMessage(_ data: Data, contentType: String?, status: Int) -> String {
    if let e = try? JSONDecoder().decode(ErrorBody.self, from: data), !e.error.isEmpty { return e.error }
    let isHTML = contentType?.lowercased().hasPrefix("text/html") ?? false
    let text = String(decoding: data, as: UTF8.self)
    if !isHTML, !text.isEmpty { return String(text.prefix(300)) }
    return "Request failed (\(status))"
  }

  static func describe(_ error: any Error) -> String {
    guard let e = error as? DecodingError else { return "\(error)" }
    func at(_ path: [any CodingKey]) -> String {
      path.isEmpty ? "the top level" : path.map { $0.intValue.map(String.init) ?? $0.stringValue }.joined(separator: ".")
    }
    switch e {
    case .keyNotFound(let key, let ctx): return "\(at(ctx.codingPath + [key])) is missing"
    case .valueNotFound(_, let ctx): return "\(at(ctx.codingPath)) is null"
    case .typeMismatch(_, let ctx), .dataCorrupted(let ctx): return "\(at(ctx.codingPath)): \(ctx.debugDescription)"
    @unknown default: return "\(error)"
    }
  }
}
